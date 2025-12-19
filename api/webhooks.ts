export const config = { runtime: 'nodejs', api: { bodyParser: false } };
import Stripe from 'stripe';

function buffer(req): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const ALLOWED_ORIGINS = [
    'https://my.readymag.com',
    'https://readymag.com',
    'https://readymag.website',
  ];

  const origin = req.headers.origin as string | undefined;
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';

  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      // 1) тянем line_items с ценами и продуктами
      const liResp = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product'],
        limit: 100,
      });

      const lineItems = liResp.data || [];
      console.log(
        '[webhook] session',
        session.id,
        'lineItems=',
        lineItems.length
      );

      // сначала считаем инкремент по оригинальным ценам
      const incByOriginalPrice: Record<string, number> = {};

      for (const li of lineItems) {
        const price = li.price as any;
        if (!price) continue;

        const product = price.product as any;
        const prodMeta: any = (product && product.metadata) || {};

        // мы кладём original_price_id в product_data.metadata при создании сессии
        const originalPriceId: string =
          (prodMeta.original_price_id as string) || price.id;

        const qty = li.quantity ?? 1;

        incByOriginalPrice[originalPriceId] =
          (incByOriginalPrice[originalPriceId] || 0) + qty;
      }

      // 2) переводим это в инкремент по слоту (productId + slot)
      type SlotKey = string;
      type SlotInfo = { productId: string; slot: string; inc: number };

      const slots: Record<SlotKey, SlotInfo> = {};

      for (const [priceId, inc] of Object.entries(incByOriginalPrice)) {
        const pr = await stripe.prices.retrieve(priceId);
        const pm: any = pr.metadata || {};
        const slot = (pm.slot || '').toLowerCase();
        const productId =
          typeof pr.product === 'string'
            ? (pr.product as string)
            : (pr.product as any).id;

        if (!slot || !productId) continue;

        const key = `${productId}__${slot}`;

        if (!slots[key]) {
          slots[key] = { productId, slot, inc: 0 };
        }
        slots[key].inc += inc as number;
      }

      // 3) для каждого слота обновляем booked_seats у всех цен этого слота
      for (const key of Object.keys(slots)) {
        const { productId, slot, inc } = slots[key];

        const prices = await stripe.prices.list({
          product: productId,
          active: true,
          limit: 100,
        });

        const slotPrices = prices.data.filter((p) => {
          const pm: any = p.metadata || {};
          return (pm.slot || '').toLowerCase() === slot;
        });

        if (slotPrices.length === 0) continue;

        await Promise.all(
          slotPrices.map(async (p) => {
            const currentBooked = Number(
              (p.metadata as any)?.booked_seats || 0
            );
            const newBooked = currentBooked + inc;

            return stripe.prices.update(p.id, {
              metadata: {
                ...(p.metadata || {}),
                booked_seats: String(newBooked),
              },
            });
          })
        );
      }
    } catch (err) {
      console.error('Failed to update seats from webhook', err);
    }
  }

  res.json({ received: true });
}
