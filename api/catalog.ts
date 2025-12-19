export const config = { runtime: 'nodejs' };
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function handler(req, res) {
  const ALLOWED_ORIGINS = [
    'https://my.readymag.com',
    'https://readymag.com',
    'https://readymag.website',
  ];

  const origin = req.headers.origin as string | undefined;
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');

  if (req.method !== 'GET') return res.status(405).end();

  try {
    const [products, prices] = await Promise.all([
      stripe.products.list({
        active: true,
        limit: 100,
      }),
      stripe.prices.list({
        active: true,
        limit: 100,
        expand: ['data.product'],
      }),
    ]);

    const byProduct: Record<string, any> = {};

    for (const p of products.data) {
      const meta: any = p.metadata || {};

      const base = {
        productId: p.id,
        title: p.name,
        image:
          p.images && p.images.length > 0
            ? p.images[0]
            : meta.image_url || null,

        ageLabel: meta.age_label || '',
        periodLabel: meta.period_label || '',
        season: meta.season || '',

        disciplineKey: meta.discipline_key || '',
        readymagPage: meta.readymag_page || '',
      };

      byProduct[p.id] = {
        base,
        slots: {} as Record<string, any>,
      };
    }

    for (const pr of prices.data) {
      const prod = pr.product as any;
      const parent = byProduct[prod.id];
      if (!parent) continue;

      const pm: any = pr.metadata || {};
      const slot = (pm.slot || '').toLowerCase();
      const discount = (pm.discount || 'full').toLowerCase();
      const timeLabel = pm.time_label || '';

      if (!slot) continue;

      if (!parent.slots[slot]) {
        parent.slots[slot] = {
          fullPriceId: null,
          discPriceId: null,
          fullAmount: null,
          timeLabel: '',
          maxSeats: 0,
          bookedSeats: 0,
        };
      }

      const s = parent.slots[slot];

      if (discount === 'full') {
        s.fullPriceId = pr.id;
        s.fullAmount = pr.unit_amount;
      } else if (discount === 'disc10') {
        s.discPriceId = pr.id;
      }

      if (discount === 'full') {
        if (timeLabel) s.timeLabel = timeLabel;
        if (pm.max_seats !== undefined && pm.max_seats !== '')
          s.maxSeats = Number(pm.max_seats);
        if (pm.booked_seats !== undefined && pm.booked_seats !== '')
          s.bookedSeats = Number(pm.booked_seats);
      }
    }

    const catalog: any[] = [];

    Object.values(byProduct).forEach((p: any) => {
      const base = p.base;

      Object.entries(p.slots).forEach(([slotKey, sAny]) => {
        const s = sAny as any;

        if (!s.fullPriceId || !s.fullAmount) return;

        const maxSeats = s.maxSeats || 0;
        const bookedSeats = s.bookedSeats || 0;
        const freeSeats =
          maxSeats > 0 ? Math.max(0, maxSeats - bookedSeats) : null;

        catalog.push({
          id: base.productId + '__' + slotKey,
          productId: base.productId,
          title: base.title,
          image: base.image,

          ageLabel: base.ageLabel,
          periodLabel: base.periodLabel,
          season: base.season,

          disciplineKey: base.disciplineKey,
          readymagPage: base.readymagPage,

          slot: slotKey,
          timeLabel: s.timeLabel || '',
          amount: s.fullAmount,

          fullPriceId: s.fullPriceId,
          discPriceId: s.discPriceId,

          maxSeats,
          bookedSeats,
          freeSeats,
        });
      });
    });

    res.json({ catalog });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'catalog_failed' });
  }
}
