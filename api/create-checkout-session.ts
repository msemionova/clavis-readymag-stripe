export const config = { runtime: 'nodejs' };
import Stripe from 'stripe';

export default async function handler(req, res) {
  const ALLOWED_ORIGINS = [
    'https://my.readymag.com',
    'https://readymag.com',
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
        week: number | string;
        week_label?: string;
        camp_type?: string;
        slot: 'morning' | 'afternoon';
        childFirst: string;
        childLast: string;
        basePriceEUR?: number;
        prices: { fullPriceId: string; discPriceId: string };
        // дополнительные поля, которые мы кладём из фронта
        productId?: string;
        title?: string;
        periodLabel?: string;
        timeLabel?: string;
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
      }),
    );

    // ========= ПРОВЕРКА МЕСТ ПО СЛОТУ (productId + slot) =========

    type CapData = {
      maxSeats: number;
      bookedSeats: number;
      demand: number;
    };

    const caps = new Map<string, CapData>();

    items.forEach((it, idx) => {
      const slot = it.slot;
      const productId = (it as any).productId || 'unknown';

      const key = `${productId}__${slot}`;

      const fullId = it.prices.fullPriceId;
      const isDiscounted = idx > 0;
      const chosenId = isDiscounted
        ? it.prices.discPriceId
        : it.prices.fullPriceId;

      const fullEntry = cache.get(fullId);
      const entry = fullEntry || cache.get(chosenId);
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

    // ========= Остальная твоя логика (line_items, summary) =========

    const capFirst = (s?: string) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    // Stripe line_items с красивым названием и description
    const line_items = items.map((it, idx) => {
      const isDiscounted = idx > 0;
      const chosenId = isDiscounted
        ? it.prices.discPriceId
        : it.prices.fullPriceId;

      const cached = cache.get(chosenId);
      if (!cached) {
        throw new Error(`Price not in cache: ${chosenId}`);
      }

      const { amount, currency } = cached;

      // крупный заголовок — оригинальное название курса
      const courseTitle =
        it.title ||
        (it.camp_type ? `Camp ${capFirst(it.camp_type)}` : 'Camp');

      const descParts: string[] = [];

      if (it.childFirst || it.childLast) {
        descParts.push(
          `Kind: ${[it.childFirst, it.childLast]
            .filter(Boolean)
            .join(' ')}`,
        );
      }

      const periodLabel =
        (it as any).periodLabel || (it as any).period_label || '';

      if (periodLabel) {
        descParts.push(`Zeitraum: ${periodLabel}`);
      } else if (it.week_label || it.week) {
        descParts.push(`Woche: ${it.week_label || `W${it.week}`}`);
      }

      const timeLabel =
        (it as any).timeLabel || (it as any).time_label || '';

      if (timeLabel) {
        descParts.push(`Zeit: ${timeLabel}`);
      }

      const description = descParts.join(' • ');

      return {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: courseTitle + (isDiscounted ? ' (−10%)' : ''),
            description,
            metadata: {
              week: String(it.week),
              week_label: it.week_label || '',
              camp_type: it.camp_type || '',
              slot: it.slot,
              childFirst: it.childFirst,
              childLast: it.childLast,
              original_price_id: chosenId,
              title: it.title || '',
              period_label: periodLabel,
              time_label: timeLabel,
              product_id: (it as any).productId || '',
            },
          },
        },
      };
    });

    function norm(s: string) {
      return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    type ChildKey = string;
    type ChildValue = {
      first: string;
      last: string;
      items: Array<{
        week: string | number;
        week_label?: string;
        camp?: string;
        slot: string;
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
        week: it.week,
        week_label: it.week_label,
        camp: it.camp_type,
        slot: it.slot,
      });
    }

    const totalChildren = byChild.size;

    const orderSummary = Array.from(byChild.values())
      .map((ch) => {
        const parts = ch.items.map((x) => {
          const wk = x.week_label || `W${x.week}`;
          const camp = x.camp ? `${x.camp}` : 'Camp';
          return `${camp} ${wk} ${x.slot}`;
        });
        return `${ch.first} ${ch.last}: ${parts.join(', ')}`;
      })
      .join('; ');

    const childrenNames = Array.from(byChild.values())
      .map((ch) => `${ch.first} ${ch.last}`)
      .join(', ');

    const successUrl = `${process.env.SUCCESS_RETURN_URL}?paid=1&session_id={CHECKOUT_SESSION_ID}`;

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
      cancel_url: `${process.env.SITE_URL}/cancelled`,
    });

    return res.json({ url: session.url });
  } catch (e: any) {
    console.error('create-checkout-session error', e);
    return res
      .status(500)
      .json({ error: 'CHECKOUT_FAILED', message: e?.message || 'Unknown error' });
  }
}
