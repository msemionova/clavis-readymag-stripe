// import-stripe.js
// запуск: node import-stripe.js

import dotenv from 'dotenv';
import { createReadStream } from 'node:fs';
import csv from 'csv-parser';
import Stripe from 'stripe';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- helpers ----------

// Чтение CSV через csv-parser, возвращаем Promise<rows[]>
function readCsv(path) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(path)
      .pipe(
        csv({
          separator: ',', // у тебя именно запятые
          // headers автоматически берутся из первой строки
          mapHeaders: ({ header }) => header.trim(),
        })
      )
      .on('data', (data) => {
        // чуть подчистим пробелы
        const cleaned = {};
        for (const [k, v] of Object.entries(data)) {
          cleaned[k] = typeof v === 'string' ? v.trim() : v;
        }
        rows.push(cleaned);
      })
      .on('end', () => resolve(rows))
      .on('error', (err) => reject(err));
  });
}

// "198,00" -> 19800 (cents)
function parseAmountToCents(str) {
  if (!str) return null;
  const normalized = str.replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  if (Number.isNaN(num)) {
    throw new Error(`Не могу распарсить сумму: "${str}"`);
  }
  return Math.round(num * 100);
}

function setMeta(target, key, value) {
  if (value !== undefined && value !== '') {
    target[key] = value;
  }
}

// ---------- main logic ----------

async function importProductsAndPrices() {
  const productsRows = await readCsv('./stripe/imports/products.csv');
  const pricesRows = await readCsv('./stripe/imports/prices.csv');

  console.log(`Прочитано продуктов: ${productsRows.length}`);
  console.log(`Прочитано цен:      ${pricesRows.length}`);

  // external product id (из CSV "id") -> настояший Stripe product.id
  const productIdMap = {};

  // 1) Создаём продукты
  for (const row of productsRows) {
    const externalId = row['id']; // твой id из CSV
    console.log(`\nСоздаю продукт externalId=${externalId}...`);

    const metadata = {};
    setMeta(metadata, 'external_product_id', externalId);
    setMeta(metadata, 'readymag_page', row['metadata[readymag_page]']);
    setMeta(metadata, 'product_id', row['metadata[product_id]']);
    setMeta(metadata, 'title', row['metadata[title]']);
    setMeta(metadata, 'time_label', row['metadata[time_label]']);
    setMeta(metadata, 'season', row['metadata[season]']);
    setMeta(metadata, 'discipline_key', row['metadata[discipline_key]']);
    setMeta(metadata, 'period_label', row['metadata[period_label]']);
    setMeta(metadata, 'age_label', row['metadata[age_label]']);
    setMeta(metadata, 'original_price_id', row['metadata[original_price_id]']);
    setMeta(metadata, 'pricing', row['metadata[pricing]']);
    setMeta(metadata, 'slot', row['metadata[slot]']);

    const productBody = {
      name: row.name,
      active: row.active === 'true' || row.active === '1',
      description: row.description || undefined,
      metadata,
    };

    // Можно сделать upsert логикой: поиск по metadata.external_product_id
    // но пока просто создаём
    const product = await stripe.products.create(productBody);

    productIdMap[externalId] = product.id;

    console.log(
      ` → создан product.id=${product.id} (externalId=${externalId})`
    );
  }

  // 2) Создаём цены
  for (const row of pricesRows) {
    const logicalPriceId = row['Price ID']; // твой логический id
    const externalProductId = row['Product ID'];
    const stripeProductId = productIdMap[externalProductId];

    if (!stripeProductId) {
      console.warn(
        `\n⚠️ Пропускаю цену ${logicalPriceId}: не найден продукт для Product ID = ${externalProductId}`
      );
      continue;
    }

    const amountCents = parseAmountToCents(row['Amount']);
    const currency = (row['Currency'] || '').toLowerCase() || 'eur';

    const interval = row['Interval'];
    const intervalCountStr = row['Interval Count'];
    const intervalCount = intervalCountStr
      ? Number(intervalCountStr)
      : undefined;

    const priceBody = {
      currency,
      product: stripeProductId,
      unit_amount: amountCents,
      billing_scheme: row['Billing Scheme'] || 'per_unit',
      nickname: row['Description'] || row['Product Name'] || undefined,
      tax_behavior: row['Tax Behavior'] || 'unspecified',
      metadata: {},
    };

    // recurring, если задан Interval
    if (interval) {
      priceBody.recurring = {
        interval,
        interval_count: intervalCount || 1,
        usage_type: row['Usage Type'] || 'licensed',
      };
      if (row['Aggregate Usage']) {
        priceBody.recurring.aggregate_usage = row['Aggregate Usage'];
      }
    }

    // metadata для цены
    setMeta(priceBody.metadata, 'logical_price_id', logicalPriceId);
    setMeta(
      priceBody.metadata,
      'full_day_discount_eur',
      row['full_day_discount_eur (metadata)']
    );
    setMeta(priceBody.metadata, 'booked_seats', row['booked_seats (metadata)']);
    setMeta(priceBody.metadata, 'max_seats', row['max_seats (metadata)']);
    setMeta(priceBody.metadata, 'time_label', row['time_label (metadata)']);
    setMeta(priceBody.metadata, 'slot', row['slot (metadata)']);
    setMeta(priceBody.metadata, 'discount', row['discount (metadata)']);

    console.log(
      `\nСоздаю цену logicalPriceId=${logicalPriceId} для продукта ${externalProductId} (stripeProductId=${stripeProductId}), amount=${amountCents} ${currency}`
    );

    const price = await stripe.prices.create(priceBody);

    console.log(
      ` → создан price.id=${price.id} (logicalPriceId=${logicalPriceId})`
    );
  }

  console.log('\nИмпорт завершён ✅');
}

// ---------- run ----------

importProductsAndPrices().catch((err) => {
  console.error('Ошибка при импорте:', err);
  process.exit(1);
});
