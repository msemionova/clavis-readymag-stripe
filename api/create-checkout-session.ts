export const config = { runtime: 'nodejs' };
import Stripe from 'stripe';

export default async function handler(req, res) {
  const ALLOWED_ORIGINS = [
    'https://my.readymag.com',
    'https://readymag.com',
    'https://readymag.website',
  ];

  const origin = req.headers.origin as string | undefined;
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';

  // CORS для любого ответа
  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const { email, items } = req.body as {
      email: string;
      items: Array<{
        slot: 'morning' | 'afternoon';
        childFirst: string;
        childLast: string;
        basePriceEUR?: number;
        prices: { fullPriceId: string; discPriceId: string };
        productId?: string;
        title?: string;
        periodLabel?: string;
        timeLabel?: string;
        disciplineKey?: string;
        childDob?: string;
      }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'EMPTY_CART' });
    }

    // Находим/создаём customer
    const found = await stripe.customers.list({ email, limit: 1 });
    const customer =
      found.data[0] ?? (await stripe.customers.create({ email }));

    // Собираем нужные priceId
    const needed = new Set<string>();
    items.forEach((it) => {
      if (it.prices?.fullPriceId) needed.add(it.prices.fullPriceId);
      if (it.prices?.discPriceId) needed.add(it.prices.discPriceId);
    });

    // Кеш цен (с metadata)
    const cache = new Map<
      string,
      { amount: number; currency: string; metadata: Record<string, any> }
    >();

    await Promise.all(
      Array.from(needed).map(async (id) => {
        const pr = await stripe.prices.retrieve(id);
        if (!pr.unit_amount || !pr.currency) {
          throw new Error(`Price ${id} missing unit_amount/currency`);
        }
        cache.set(id, {
          amount: pr.unit_amount,
          currency: pr.currency,
          metadata: (pr.metadata || {}) as Record<string, any>,
        });
      })
    );

    // ========= ПРОВЕРКА МЕСТ ПО СЛОТУ (productId + slot) =========

    type CapData = {
      maxSeats: number;
      bookedSeats: number;
      demand: number;
    };

    const caps = new Map<string, CapData>();

    items.forEach((it) => {
      const slot = it.slot;
      const productId = (it as any).productId || 'unknown';
      const key = `${productId}__${slot}`;
      const fullId = it.prices.fullPriceId;

      const entry = cache.get(fullId);
      const meta = (entry?.metadata || {}) as any;

      const maxSeats = Number(meta.max_seats || 0);
      const bookedSeats = Number(meta.booked_seats || 0);

      const existing = caps.get(key) || {
        maxSeats: 0,
        bookedSeats: 0,
        demand: 0,
      };

      if (!existing.maxSeats && maxSeats) existing.maxSeats = maxSeats;
      if (!existing.bookedSeats && bookedSeats)
        existing.bookedSeats = bookedSeats;

      existing.demand += 1;
      caps.set(key, existing);
    });

    // Проверяем каждый слот целиком (full + discount вместе)
    for (const [key, cap] of caps.entries()) {
      if (!cap.maxSeats) continue; // 0 → без ограничения
      const free = cap.maxSeats - cap.bookedSeats;
      if (cap.demand > free) {
        return res.status(400).json({
          error: 'NO_CAPACITY',
          message:
            'Für diesen Camp sind nicht genug Plätze verfügbar. Bitte wählen Sie weniger Plätze oder einen anderen Termin.',
        });
      }
    }

    // === ГРУППИРУЕМ ПО ДЕТЯМ (нужно ДО line_items) ===
    function norm(s: string) {
      return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    type ChildKey = string;
    type ChildValue = {
      first: string;
      last: string;
      items: Array<{
        slot: string;
        periodLabel?: string;
        timeLabel?: string;
        disciplineKey?: string;
      }>;
    };

    const byChild = new Map<ChildKey, ChildValue>();

    for (const it of items) {
      const key = `${norm(it.childFirst)}|${norm(it.childLast)}`;
      if (!byChild.has(key)) {
        byChild.set(key, {
          first: it.childFirst,
          last: it.childLast,
          items: [],
        });
      }
      byChild.get(key)!.items.push({
        slot: it.slot,
        periodLabel: it.periodLabel || '',
        timeLabel: it.timeLabel || '',
        disciplineKey: it.disciplineKey || '',
      });
    }

    const childKeys = Array.from(byChild.keys());
    // const primaryChildKey = childKeys[0] || null; // если понадобится отличать "основного"
    const siblingKeys = new Set(childKeys.slice(1)); // все, кроме первого — сиблинги
    const totalChildren = byChild.size;

    // === ПОЛНЫЙ ДЕНЬ: минус X евро, если один ребёнок ===

    // индекс -> размер скидки в центах
    const fullDayDiscountPerIndex = new Map<number, number>();

    if (totalChildren === 1) {
      type DaySlotInfo = { morningIdx?: number; afternoonIdx?: number };
      const dayMap = new Map<string, DaySlotInfo>();

      // Для каждого дня, где есть и утро, и вторая половина, даём скидку на вторую половину дня
      for (const [, info] of dayMap.entries()) {
        if (info.morningIdx != null && info.afternoonIdx != null) {
          const afternoonItem = items[info.afternoonIdx];

          const fullEntry = cache.get(afternoonItem.prices.fullPriceId);
          const meta = (fullEntry?.metadata || {}) as any;

          // клиенты могут менять это число в Stripe (metadata.full_day_discount_eur)
          const fullDayDiscountEur = Number(
            meta.full_day_discount_eur || '100'
          );
          const discountCents = Math.round(fullDayDiscountEur * 100);

          if (discountCents > 0) {
            fullDayDiscountPerIndex.set(info.afternoonIdx, discountCents);
          }
        }
      }
    }

    // ========= Остальная логика (line_items, summary) =========

    const nameRe = /^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]{1,60}$/;

    for (const it of items) {
      if (
        !nameRe.test((it.childFirst || '').trim()) ||
        !nameRe.test((it.childLast || '').trim())
      ) {
        return res.status(400).json({
          error:
            'Bitte geben Sie die korrekten Namen ein - in lateinischer Sprache, ohne unnötige Zeiche',
        });
      }

      const dob = (it as any).childDob;

      if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return res.status(400).json({ error: 'INVALID_DOB' });
      }

      const d = new Date(dob + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'INVALID_DOB' });
      }

      const year = d.getUTCFullYear();
      const now = new Date();
      const age = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);

      if (year < 1900 || year > now.getUTCFullYear() || age < 6 || age > 18) {
        return res.status(400).json({ error: 'INVALID_DOB' });
      }
    }

    const line_items = items.map((it, idx) => {
      const childKey = `${norm(it.childFirst)}|${norm(it.childLast)}`;
      const isSibling = siblingKeys.has(childKey);
      const hasSiblingInCart = totalChildren >= 2;
      const applySiblingDiscount = hasSiblingInCart && isSibling;

      const fullEntry = cache.get(it.prices.fullPriceId);
      if (!fullEntry) {
        throw new Error(`Price not in cache: ${it.prices.fullPriceId}`);
      }

      const discEntry = it.prices.discPriceId
        ? cache.get(it.prices.discPriceId)
        : undefined;

      let amount = fullEntry.amount;
      const currency = fullEntry.currency;

      // 1) скидка сиблингу: берём discPrice, если есть, иначе 0.9 от полной
      if (applySiblingDiscount) {
        if (discEntry) {
          amount = discEntry.amount;
        } else {
          amount = Math.round(fullEntry.amount * 0.9);
        }
      }

      // 2) скидка за полный день (только когда один ребёнок)
      const hasFullDayDiscountHere =
        totalChildren === 1 && fullDayDiscountPerIndex.has(idx);

      if (hasFullDayDiscountHere) {
        const discountCents = fullDayDiscountPerIndex.get(idx)!;
        amount = Math.max(0, amount - discountCents);
      }

      // какой прайс считаем "базовым" для метадаты и вебхуков
      const chosenBasePriceId =
        applySiblingDiscount && it.prices.discPriceId
          ? it.prices.discPriceId
          : it.prices.fullPriceId;

      const courseTitle = it.title;

      const labels: string[] = [];
      if (applySiblingDiscount) labels.push('Geschwisterrabatt −10%');
      if (hasFullDayDiscountHere) labels.push('Ganztagsrabatt');

      const titleSuffix = labels.length ? ` (${labels.join(', ')})` : '';
      const courseTitleFinal = courseTitle + titleSuffix;

      const descParts: string[] = [];

      if (it.childFirst || it.childLast) {
        descParts.push(
          `Kind: ${[it.childFirst, it.childLast].filter(Boolean).join(' ')}`
        );
      }

      const periodLabel =
        (it as any).periodLabel || (it as any).period_label || '';

      const disciplineKey =
        (it as any).disciplineKey || (it as any).discipline_key || '';

      if (periodLabel) {
        descParts.push(periodLabel);
      }
      const timeLabel = (it as any).timeLabel || (it as any).time_label || '';

      if (timeLabel) {
        descParts.push(timeLabel);
      }

      const description = descParts.join(' • ');

      return {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: courseTitleFinal,
            description,
            metadata: {
              slot: it.slot,
              childFirst: it.childFirst,
              childLast: it.childLast,
              original_price_id: chosenBasePriceId,
              title: it.title || '',
              period_label: periodLabel,
              time_label: timeLabel,
              discipline_key: disciplineKey,
              product_id: (it as any).productId || '',
              child_dob: (it as any).childDob || '',
              discount_type: applySiblingDiscount
                ? 'sibling_10'
                : hasFullDayDiscountHere
                ? 'full_day'
                : 'none',
            },
          },
        },
      };
    });

    const orderSummary = Array.from(byChild.values())
      .map((ch) => {
        const parts = ch.items.map((x) => {
          return `${x.disciplineKey} · ${x.periodLabel} · ${x.timeLabel}`;
        });
        return `${ch.first} ${ch.last}: ${parts.join(', ')}`;
      })
      .join('; ');

    const childrenNames = Array.from(byChild.values())
      .map((ch) => `${ch.first} ${ch.last}`)
      .join(', ');

    const successUrl = `${process.env.SUCCESS_URL}?paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.RETURN_URL}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      line_items,
      allow_promotion_codes: false,
      payment_intent_data: {
        metadata: {
          order_summary: orderSummary,
          total_children: String(totalChildren),
          items_count: String(items.length),
          children_names: childrenNames,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.json({ url: session.url });
  } catch (e: any) {
    console.error('create-checkout-session error', e);
    return res.status(500).json({
      error: 'CHECKOUT_FAILED',
      message: e?.message || 'Unknown error',
    });
  }
}
