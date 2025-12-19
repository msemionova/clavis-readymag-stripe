import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convertStripeJSONToCSV() {
  console.log('🔄 Конвертация JSON от stripe-cli в CSV для импорта...\n');

  try {
    // Проверяем наличие директорий
    const exportsDir = path.join(__dirname, 'exports');
    const importsDir = path.join(__dirname, 'imports');

    if (!fs.existsSync(exportsDir)) {
      console.error('❌ Директория "exports" не найдена');
      console.log('💡 Сначала выполните экспорт:');
      console.log(
        '   stripe products list --limit 100 > exports/products.json'
      );
      console.log('   stripe prices list --limit 100 > exports/prices.json');
      process.exit(1);
    }

    if (!fs.existsSync(importsDir)) {
      fs.mkdirSync(importsDir, { recursive: true });
    }

    // 1. Конвертируем продукты
    console.log('📦 Конвертация продуктов...');
    await convertProducts();

    // 2. Конвертируем цены
    console.log('\n💰 Конвертация цен...');
    await convertPrices();

    console.log('\n✅ Конвертация завершена!');
    console.log('\n📁 Созданы файлы:');
    console.log('   - imports/products.csv');
    console.log('   - imports/prices.csv');
    console.log('\n💡 Следующие шаги:');
    console.log('   1. Проверьте созданные файлы');
    console.log('   2. Запустите валидацию: node validate_csv.js');
    console.log('   3. Запустите импорт: node import.js');
  } catch (error) {
    console.error('❌ Ошибка конвертации:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

async function convertProducts() {
  const productsPath = path.join(__dirname, 'exports', 'products.json');

  if (!fs.existsSync(productsPath)) {
    throw new Error(`Файл не найден: ${productsPath}`);
  }

  // Читаем JSON
  const jsonData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const products = jsonData.data || [];

  console.log(`   Найдено продуктов: ${products.length}`);

  if (products.length === 0) {
    console.warn('   ⚠️  Нет продуктов для конвертации');
    return;
  }

  // Формат CSV для импорта продуктов (ваш формат)
  const csvLines = [
    // Заголовок (ваш формат)
    'id,object,active,name,description,images,metadata[readymag_page],metadata[camp_page],metadata[product_id],metadata[title],metadata[time_label],metadata[camp_type],metadata[season],metadata[discipline_key],metadata[period_label],metadata[age_label],metadata[original_price_id],metadata[pricing],metadata[slot],metadata[childLast],metadata[childFirst]',
  ];

  products.forEach((product) => {
    const metadata = product.metadata || {};

    // Подготавливаем изображения
    let imagesString = '';
    if (Array.isArray(product.images) && product.images.length > 0) {
      imagesString = product.images[0]; // Берем только первое изображение
    } else if (product.image) {
      imagesString = product.image;
    }

    // Формируем строку CSV с правильным экранированием
    const csvRow = [
      `"${product.id || ''}"`,
      '"product"', // object - всегда "product"
      `"${product.active ? 'true' : 'false'}"`, // active в нижнем регистре!
      `"${escapeCSVField(product.name || '')}"`,
      `"${escapeCSVField(product.description || '')}"`,
      `"${escapeCSVField(imagesString)}"`,
      `"${escapeCSVField(metadata.readymag_page || '')}"`,
      `"${escapeCSVField(metadata.camp_page || '')}"`,
      `"${escapeCSVField(metadata.product_id || '')}"`,
      `"${escapeCSVField(metadata.title || '')}"`,
      `"${escapeCSVField(metadata.time_label || '')}"`,
      `"${escapeCSVField(metadata.camp_type || '')}"`,
      `"${escapeCSVField(metadata.season || 'winter_2026')}"`,
      `"${escapeCSVField(
        metadata.discipline_key || getDisciplineKey(product.name)
      )}"`,
      `"${escapeCSVField(metadata.period_label || '02 – 06 Februar')}"`,
      `"${escapeCSVField(metadata.age_label || getAgeLabel(product.name))}"`,
      `"${escapeCSVField(metadata.original_price_id || '')}"`,
      `"${escapeCSVField(metadata.pricing || '')}"`,
      `"${escapeCSVField(
        metadata.slot || getSlotFromTime(metadata.time_label)
      )}"`,
      `"${escapeCSVField(metadata.childLast || '')}"`,
      `"${escapeCSVField(metadata.childFirst || '')}"`,
    ].join(',');

    csvLines.push(csvRow);
  });

  // Сохраняем
  const outputPath = path.join(__dirname, 'imports', 'products.csv');
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
  console.log(`   ✅ Файл сохранен: ${outputPath}`);

  // Показываем пример
  console.log('\n📝 Пример продукта в CSV:');
  console.log(csvLines[1]);
}

async function convertPrices() {
  const pricesPath = path.join(__dirname, 'exports', 'prices.json');

  if (!fs.existsSync(pricesPath)) {
    throw new Error(`Файл не найден: ${pricesPath}`);
  }

  // Читаем JSON
  const jsonData = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  const prices = jsonData.data || [];

  console.log(`   Найдено цен: ${prices.length}`);

  if (prices.length === 0) {
    console.warn('   ⚠️  Нет цен для конвертации');
    return;
  }

  // Получаем имена продуктов для связи
  const productsData = await loadProductsForMapping();
  const productMap = {};
  productsData.forEach((product) => {
    productMap[product.id] = {
      name: product.name,
      metadata: product.metadata || {},
    };
  });

  // Формат CSV для импорта цен (ваш формат)
  const csvLines = [
    // Заголовок (ваш формат)
    'Price ID,Product ID,Product Name,Product Statement Descriptor,Product Tax Code,Description,Created (UTC),Amount,Currency,Interval,Interval Count,Usage Type,Aggregate Usage,Billing Scheme,Trial Period Days,Tax Behavior,full_day_discount_eur (metadata),booked_seats (metadata),max_seats (metadata),time_label (metadata),slot (metadata),discount (metadata)',
  ];

  prices.forEach((price) => {
    const metadata = price.metadata || {};
    const productInfo = productMap[price.product] || { name: '', metadata: {} };
    const productName = productInfo.name;
    const productMetadata = productInfo.metadata;

    // Конвертируем unit_amount (центы) → Amount ("225,00")
    let amountFormatted = '0,00';
    if (price.unit_amount) {
      const amountEuros = (price.unit_amount / 100).toFixed(2);
      amountFormatted = amountEuros.replace('.', ',');
    }

    // Форматируем дату (created в секундах Unix)
    let formattedDate = '';
    if (price.created) {
      const createdDate = new Date(price.created * 1000);
      formattedDate = createdDate
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);
    }

    // Определяем time_label
    const timeLabel = metadata.time_label || productMetadata.time_label || '';

    // Определяем slot
    let slot = metadata.slot || productMetadata.slot || '';
    if (!slot && timeLabel) {
      slot = getSlotFromTime(timeLabel);
    }

    // Определяем discount
    const discount =
      metadata.discount ||
      (price.nickname && price.nickname.toLowerCase().includes('discount')
        ? 'disc10'
        : 'full');

    // Формируем строку CSV
    const csvRow = [
      `"${price.id || ''}"`,
      `"${price.product || ''}"`,
      `"${escapeCSVField(productName)}"`,
      '""', // Product Statement Descriptor
      '""', // Product Tax Code
      `"${escapeCSVField(
        price.nickname || getDescriptionFromPrice(price, metadata)
      )}"`,
      `"${formattedDate}"`,
      `"${amountFormatted}"`,
      `"${price.currency || 'eur'}"`,
      `"${price.recurring?.interval || ''}"`,
      `"${price.recurring?.interval_count || ''}"`,
      `"${price.recurring?.usage_type || ''}"`,
      `"${price.recurring?.aggregate_usage || ''}"`,
      `"${price.billing_scheme || 'per_unit'}"`,
      `"${price.recurring?.trial_period_days || ''}"`,
      `"${price.tax_behavior || 'unspecified'}"`,
      `"${metadata.full_day_discount_eur || '0'}"`,
      `"${metadata.booked_seats || '0'}"`,
      `"${metadata.max_seats || '12'}"`,
      `"${escapeCSVField(timeLabel)}"`,
      `"${slot}"`,
      `"${discount}"`,
    ].join(',');

    csvLines.push(csvRow);
  });

  // Сохраняем
  const outputPath = path.join(__dirname, 'imports', 'prices.csv');
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
  console.log(`   ✅ Файл сохранен: ${outputPath}`);

  // Показываем пример
  console.log('\n📝 Пример цены в CSV:');
  console.log(csvLines[1]);
}

// Вспомогательные функции
async function loadProductsForMapping() {
  const productsPath = path.join(__dirname, 'exports', 'products.json');
  if (fs.existsSync(productsPath)) {
    try {
      const jsonData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      return jsonData.data || [];
    } catch (error) {
      console.warn('   ⚠️  Не удалось загрузить продукты для маппинга');
      return [];
    }
  }
  return [];
}

function escapeCSVField(str) {
  if (str === null || str === undefined) return '';
  // Экранируем кавычки внутри строки
  return str.toString().replace(/"/g, '""');
}

function getDisciplineKey(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('fashion')) return 'fashion_design';
  if (name.includes('manga') || name.includes('comics')) return 'drawing';
  if (name.includes('digital') || name.includes('drawing')) return 'drawing';
  if (name.includes('animation')) return 'animation';
  return 'drawing';
}

function getAgeLabel(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('8-11') || name.includes('8–11')) return '8–11 Jahre';
  return '10+ Jahre';
}

function getSlotFromTime(timeLabel) {
  if (!timeLabel) return '';
  if (timeLabel.includes('09:30') || timeLabel.includes('morning'))
    return 'morning';
  if (timeLabel.includes('13:00') || timeLabel.includes('afternoon'))
    return 'afternoon';
  return '';
}

function getDescriptionFromPrice(price, metadata) {
  if (price.nickname) return price.nickname;

  const slot = metadata.slot || getSlotFromTime(metadata.time_label);
  const discount = metadata.discount || 'full';

  if (discount === 'full') {
    return `${slot === 'morning' ? 'Morning' : 'Afternoon'} Full Price`;
  } else {
    return `${slot === 'morning' ? 'Morning' : 'Afternoon'} ${discount.replace(
      'disc',
      ''
    )}% Discount`;
  }
}

// Запуск
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  convertStripeJSONToCSV();
}

export { convertStripeJSONToCSV };
