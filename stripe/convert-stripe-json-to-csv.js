import fs from 'fs';
import path from 'path';

async function convertStripeJSONToCSV() {
  console.log('🔄 Конвертация JSON от stripe-cli в CSV для импорта...\n');

  try {
    // 1. Конвертируем продукты
    console.log('📦 Конвертация продуктов...');
    await convertProducts();

    // 2. Конвертируем цены
    console.log('\n💰 Конвертация цен...');
    await convertPrices();

    console.log('\n✅ Конвертация завершена!');
    console.log('\n📁 Созданы файлы:');
    console.log('   - products.csv');
    console.log('   - prices.csv');
    console.log('\n💡 Импортируйте через Stripe Dashboard:');
    console.log('   Products → ⚡ Actions → Import → Выберите CSV файлы');
  } catch (error) {
    console.error('❌ Ошибка конвертации:', error.message);
    process.exit(1);
  }
}

async function convertProducts() {
  // Читаем JSON
  const jsonData = JSON.parse(
    fs.readFileSync('./stripe/exports/products.json', 'utf8')
  );
  const products = jsonData.data;

  console.log(`   Найдено продуктов: ${products.length}`);

  // Формат CSV для импорта продуктов
  const csvLines = [
    // Заголовок (формат импорта Stripe)
    'id,object,active,name,description,images,metadata[readymag_page],metadata[camp_page],metadata[product_id],metadata[title],metadata[time_label],metadata[camp_type],metadata[season],metadata[discipline_label_en],metadata[discipline_label_de],metadata[week_label],metadata[discipline_key],metadata[period_label],metadata[age_label],metadata[original_price_id],metadata[pricing],metadata[slot],metadata[week],metadata[childLast],metadata[childFirst]',
  ];

  products.forEach((product) => {
    const metadata = product.metadata || {};

    const line = [
      `"${product.id}"`,
      '"product"',
      product.active ? '"TRUE"' : '"FALSE"',
      `"${escapeCSV(product.name)}"`,
      `"${escapeCSV(product.description || '')}"`,
      `"${(product.images || []).join(';')}"`,
      `"${metadata.readymag_page || ''}"`,
      `"${metadata.camp_page || ''}"`,
      `"${metadata.product_id || ''}"`,
      `"${metadata.title || ''}"`,
      `"${metadata.time_label || ''}"`,
      `"${metadata.camp_type || ''}"`,
      `"${metadata.season || ''}"`,
      `"${metadata.discipline_label_en || ''}"`,
      `"${metadata.discipline_label_de || ''}"`,
      `"${metadata.week_label || ''}"`,
      `"${metadata.discipline_key || ''}"`,
      `"${metadata.period_label || ''}"`,
      `"${metadata.age_label || ''}"`,
      `"${metadata.original_price_id || ''}"`,
      `"${metadata.pricing || ''}"`,
      `"${metadata.slot || ''}"`,
      `"${metadata.week || ''}"`,
      `"${metadata.childLast || ''}"`,
      `"${metadata.childFirst || ''}"`,
    ].join(',');

    csvLines.push(line);
  });

  // Сохраняем
  fs.writeFileSync('./stripe/imports/products.csv', csvLines.join('\n'));
  console.log(`   ✅ products.csv создан`);
}

async function convertPrices() {
  // Читаем JSON
  const jsonData = JSON.parse(
    fs.readFileSync('./stripe/exports/prices.json', 'utf8')
  );
  const prices = jsonData.data;

  console.log(`   Найдено цен: ${prices.length}`);

  // Формат CSV для импорта цен (ваш формат!)
  const csvLines = [
    // Заголовок (ваш формат)
    'Price ID,Product ID,Product Name,Product Statement Descriptor,Product Tax Code,Description,Created (UTC),Amount,Currency,Interval,Interval Count,Usage Type,Aggregate Usage,Billing Scheme,Trial Period Days,Tax Behavior,full_day_discount_eur (metadata),booked_seats (metadata),max_seats (metadata),time_label (metadata),time_label_afternoon (metadata),time_label_morning (metadata),week (metadata),slot (metadata),discount (metadata)',
  ];

  // Нужно получить имена продуктов для связи
  const productsData = JSON.parse(
    fs.readFileSync('./stripe/exports/products.json', 'utf8')
  );
  const productMap = {};
  productsData.data.forEach((product) => {
    productMap[product.id] = product.name;
  });

  prices.forEach((price) => {
    const metadata = price.metadata || {};
    const productName = productMap[price.product] || '';

    // Конвертируем unit_amount (центы) → Amount ("225,00")
    const amountEuros = (price.unit_amount / 100).toFixed(2);
    const amountFormatted = amountEuros.replace('.', ',');

    // Форматируем дату
    const createdDate = new Date(price.created * 1000);
    const formattedDate = createdDate
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

    // Определяем time_label_afternoon и time_label_morning
    const timeLabel = metadata.time_label || '';
    const isAfternoon = timeLabel.includes('13:00');
    const isMorning = timeLabel.includes('09:30');

    const line = [
      `"${price.id}"`,
      `"${price.product}"`,
      `"${escapeCSV(productName)}"`,
      '""', // Product Statement Descriptor
      '""', // Product Tax Code
      `"${escapeCSV(price.nickname || '')}"`,
      `"${formattedDate}"`,
      `"${amountFormatted}"`,
      `"${price.currency}"`,
      '""', // Interval
      '""', // Interval Count
      '""', // Usage Type
      '""', // Aggregate Usage
      `"${price.billing_scheme}"`,
      '""', // Trial Period Days
      `"${price.tax_behavior}"`,
      `"${metadata.full_day_discount_eur || '0'}"`,
      `"${metadata.booked_seats || '0'}"`,
      `"${metadata.max_seats || '12'}"`,
      `"${metadata.time_label || ''}"`,
      isAfternoon ? `"${metadata.time_label}"` : '""',
      isMorning ? `"${metadata.time_label}"` : '""',
      `"${metadata.week || '1'}"`,
      `"${metadata.slot || ''}"`,
      `"${metadata.discount || ''}"`,
    ].join(',');

    csvLines.push(line);
  });

  // Сохраняем
  fs.writeFileSync('./stripe/imports/prices.csv', csvLines.join('\n'));
  console.log(`   ✅ prices.csv создан`);

  // Показываем пример
  console.log('\n📝 Пример цены в CSV:');
  console.log(csvLines[1]);
}

function escapeCSV(str) {
  if (!str) return '';
  return str.toString().replace(/"/g, '""');
}

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  convertStripeJSONToCSV();
}
