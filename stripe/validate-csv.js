import fs from 'fs';
import csv from 'csv-parser';

class CSVValidatorYourFormat {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  async validateAll() {
    console.log('🔍 Валидация CSV файлов (ваш формат импорта)...\n');

    // 1. Проверка products.csv (ваш формат)
    console.log('📦 Проверка products.csv (ваш формат):');
    const products = await this.readCSV('./stripe/imports/products.csv');
    await this.validateProductsYourFormat(products);

    // 2. Проверка prices.csv (ваш формат)
    console.log('\n💰 Проверка prices.csv (ваш формат):');
    const prices = await this.readCSV('./stripe/imports/prices.csv');
    await this.validatePricesYourFormat(prices);

    // 3. Проверка связей
    console.log('\n🔗 Проверка связей продуктов и цен:');
    await this.validateRelationshipsYourFormat(products, prices);

    // Вывод результатов
    this.printResults();

    return this.errors.length === 0;
  }

  async validateProductsYourFormat(products) {
    // ОБНОВЛЕНО: Обязательные поля для ВАШЕГО формата продуктов
    const requiredFields = [
      'id',
      'name',
      'metadata[discipline_key]',
      'metadata[age_label]',
      'metadata[week_label]',
    ];

    const recommendedFields = [
      'metadata[season]',
      'metadata[discipline_label_de]',
      'metadata[discipline_label_en]',
      'metadata[period_label]',
      'description',
    ];

    products.forEach((row, index) => {
      // Проверка что строка не пустая
      if (Object.keys(row).length === 0) {
        this.warnings.push(`products.csv строка ${index + 2}: Пустая строка`);
        return;
      }

      // Отладка: показываем все поля для первой строки
      if (index === 0) {
        console.log('\n   Поля в первой строке products.csv:');
        Object.keys(row).forEach((key) => {
          console.log(
            `   - "${key}": "${row[key]?.substring(0, 50)}${
              row[key]?.length > 50 ? '...' : ''
            }"`
          );
        });
      }

      // Проверка обязательных полей
      requiredFields.forEach((field) => {
        if (row[field] === undefined || row[field] === '') {
          this.errors.push(
            `products.csv строка ${
              index + 2
            }: Поле "${field}" пустое или отсутствует`
          );
        }
      });

      // Проверка рекомендованных полей
      recommendedFields.forEach((field) => {
        if (row[field] === undefined || row[field] === '') {
          this.warnings.push(
            `products.csv строка ${
              index + 2
            }: Рекомендуемое поле "${field}" пустое`
          );
        }
      });

      // Проверка формата ID продукта
      if (row.id && !row.id.startsWith('prod_')) {
        this.errors.push(
          `products.csv строка ${index + 2}: ID "${
            row.id
          }" должен начинаться с "prod_"`
        );
      }

      // Проверка активного статуса
      if (
        row.active !== undefined &&
        !['TRUE', 'FALSE', 'true', 'false'].includes(row.active)
      ) {
        this.warnings.push(
          `products.csv строка ${
            index + 2
          }: Поле "active" должно быть TRUE/FALSE, получено: "${row.active}"`
        );
      }

      // Проверка метаданных season
      if (
        row['metadata[season]'] &&
        !row['metadata[season]'].includes('2026')
      ) {
        this.warnings.push(
          `products.csv строка ${index + 2}: Сезон "${
            row['metadata[season]']
          }" может быть некорректным, ожидается winter_2026`
        );
      }
    });

    console.log(`   Найдено продуктов: ${products.length}`);

    // Показываем пример данных
    if (products.length > 0) {
      console.log('\n   Пример первого продукта:');
      const product = products[0];
      console.log(`   ID: ${product.id || 'нет'}`);
      console.log(`   Name: ${product.name || 'нет'}`);
      console.log(`   Season: ${product['metadata[season]'] || 'нет'}`);
      console.log(
        `   Discipline: ${product['metadata[discipline_key]'] || 'нет'}`
      );
      console.log(`   Age: ${product['metadata[age_label]'] || 'нет'}`);
      console.log(`   Week: ${product['metadata[week_label]'] || 'нет'}`);
    }
  }

  async validatePricesYourFormat(prices) {
    // ОБНОВЛЕНО: Обязательные поля для ВАШЕГО формата цен
    const requiredFields = [
      'Price ID',
      'Product ID',
      'Product Name',
      'Amount',
      'Currency',
      'Description',
      'slot (metadata)',
      'discount (metadata)',
    ];

    const recommendedFields = [
      'Product Statement Descriptor',
      'Product Tax Code',
      'Created (UTC)',
      'Interval',
      'Tax Behavior',
      'full_day_discount_eur (metadata)',
      'booked_seats (metadata)',
      'max_seats (metadata)',
      'time_label (metadata)',
      'week (metadata)',
    ];

    prices.forEach((row, index) => {
      // Проверка что строка не пустая
      if (Object.keys(row).length === 0) {
        this.warnings.push(`prices.csv строка ${index + 2}: Пустая строка`);
        return;
      }

      // Отладка: показываем поля для первой строки
      if (index === 0) {
        console.log('\n   Поля в первой строке prices.csv:');
        Object.keys(row).forEach((key) => {
          console.log(
            `   - "${key}": "${row[key]?.substring(0, 30)}${
              row[key]?.length > 30 ? '...' : ''
            }"`
          );
        });
      }

      // Проверка обязательных полей
      requiredFields.forEach((field) => {
        if (row[field] === undefined || row[field] === '') {
          this.errors.push(
            `prices.csv строка ${
              index + 2
            }: Поле "${field}" пустое или отсутствует`
          );
        }
      });

      // Проверка рекомендованных полей
      recommendedFields.forEach((field) => {
        if (row[field] === undefined || row[field] === '') {
          this.warnings.push(
            `prices.csv строка ${
              index + 2
            }: Рекомендуемое поле "${field}" пустое`
          );
        }
      });

      // Проверка формата ID цены
      if (row['Price ID'] && !row['Price ID'].startsWith('price_')) {
        this.errors.push(
          `prices.csv строка ${index + 2}: Price ID "${
            row['Price ID']
          }" должен начинаться с "price_"`
        );
      }

      // Проверка формата ID продукта
      if (row['Product ID'] && !row['Product ID'].startsWith('prod_')) {
        this.errors.push(
          `prices.csv строка ${index + 2}: Product ID "${
            row['Product ID']
          }" должен начинаться с "prod_"`
        );
      }

      // Проверка Amount (формат "178,20" - европейский с запятой)
      if (row.Amount) {
        const amountStr = row.Amount.toString().trim();

        // Удаляем кавычки если есть и заменяем десятичный разделитель
        const cleanAmount = amountStr.replace(/["']/g, '').trim();

        // Проверяем два возможных формата: "178,20" или "178.20"
        const isValidFormat = /^\d+[.,]\d{2}$/.test(cleanAmount);

        if (!isValidFormat) {
          this.errors.push(
            `prices.csv строка ${
              index + 2
            }: Amount "${cleanAmount}" должен быть в формате "числа,две_цифры" (например "178,20") или "числа.две_цифры"`
          );
        } else {
          // Преобразуем в число для проверки
          const numericAmount = parseFloat(cleanAmount.replace(',', '.'));

          if (isNaN(numericAmount)) {
            this.errors.push(
              `prices.csv строка ${
                index + 2
              }: Amount "${cleanAmount}" не является числом`
            );
          } else {
            // Проверяем разумность суммы (в евро)
            if (numericAmount < 1 || numericAmount > 10000) {
              this.warnings.push(
                `prices.csv строка ${
                  index + 2
                }: Amount ${numericAmount} € может быть некорректным`
              );
            }
          }
        }
      }

      // Проверка Currency
      if (row.Currency && row.Currency.length !== 3) {
        this.errors.push(
          `prices.csv строка ${index + 2}: Currency "${
            row.Currency
          }" должен быть 3 символа (например "eur")`
        );
      }

      // Проверка метаданных discount
      if (row['discount (metadata)']) {
        const discount = row['discount (metadata)'];
        if (!['full', 'disc10', 'disc15', 'disc20', ''].includes(discount)) {
          this.warnings.push(
            `prices.csv строка ${
              index + 2
            }: Неизвестное значение discount: "${discount}"`
          );
        }
      }

      // Проверка метаданных slot
      if (row['slot (metadata)']) {
        const slot = row['slot (metadata)'];
        if (!['morning', 'afternoon', 'full_day', ''].includes(slot)) {
          this.warnings.push(
            `prices.csv строка ${
              index + 2
            }: Неизвестное значение slot: "${slot}"`
          );
        }
      }

      // Проверка даты создания
      if (row['Created (UTC)']) {
        const dateStr = row['Created (UTC)'];
        const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        if (!datePattern.test(dateStr)) {
          this.warnings.push(
            `prices.csv строка ${
              index + 2
            }: Дата создания "${dateStr}" не соответствует формату YYYY-MM-DD HH:MM:SS`
          );
        }
      }
    });

    console.log(`   Найдено цен: ${prices.length}`);

    // Анализ цен по типу скидки
    if (prices.length > 0) {
      const discountGroups = {};
      prices.forEach((row) => {
        const discount = row['discount (metadata)'] || 'unknown';
        discountGroups[discount] = (discountGroups[discount] || 0) + 1;
      });

      console.log('\n   Распределение по типу скидки:');
      Object.entries(discountGroups).forEach(([discount, count]) => {
        console.log(`   - ${discount}: ${count} цен`);
      });
    }
  }

  async validateRelationshipsYourFormat(products, prices) {
    const productIds = new Set(products.map((p) => p.id).filter((id) => id));
    const priceProductIds = new Set(
      prices.map((p) => p['Product ID']).filter((id) => id)
    );

    console.log(`   Уникальных продуктов: ${productIds.size}`);
    console.log(
      `   Уникальных ссылок на продукты в ценах: ${priceProductIds.size}`
    );

    // Проверка что все продукты из prices существуют в products
    priceProductIds.forEach((productId) => {
      if (!productIds.has(productId)) {
        this.errors.push(
          `Цена ссылается на несуществующий продукт: ${productId}`
        );
      }
    });

    // Проверка что все продукты имеют хотя бы одну цену
    productIds.forEach((productId) => {
      const productPrices = prices.filter((p) => p['Product ID'] === productId);
      if (productPrices.length === 0) {
        this.warnings.push(`Продукт ${productId} не имеет ни одной цены`);
      }
    });

    // Анализ цен по продуктам
    console.log('\n   Детализация по продуктам:');
    productIds.forEach((productId) => {
      const product = products.find((p) => p.id === productId);
      const productPrices = prices.filter((p) => p['Product ID'] === productId);

      if (productPrices.length > 0) {
        const slots = [
          ...new Set(
            productPrices.map((p) => p['slot (metadata)']).filter(Boolean)
          ),
        ];
        const discounts = [
          ...new Set(
            productPrices.map((p) => p['discount (metadata)']).filter(Boolean)
          ),
        ];

        console.log(`   ${productId} (${product?.name || 'нет имени'}):`);
        console.log(`     • Количество цен: ${productPrices.length}`);
        console.log(`     • Слоты: ${slots.join(', ') || 'нет'}`);
        console.log(`     • Скидки: ${discounts.join(', ') || 'нет'}`);

        // Проверяем есть ли полная цена и скидочная цена для каждого слота
        slots.forEach((slot) => {
          const slotPrices = productPrices.filter(
            (p) => p['slot (metadata)'] === slot
          );
          const hasFullPrice = slotPrices.some(
            (p) => p['discount (metadata)'] === 'full'
          );
          const hasDiscount = slotPrices.some(
            (p) =>
              p['discount (metadata)'] !== 'full' &&
              p['discount (metadata)'] !== ''
          );

          if (!hasFullPrice) {
            this.warnings.push(
              `Продукт ${productId}, слот ${slot}: отсутствует полная цена (discount=full)`
            );
          }
          if (!hasDiscount) {
            this.warnings.push(
              `Продукт ${productId}, слот ${slot}: отсутствует скидочная цена`
            );
          }
        });
      }
    });
  }

  readCSV(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        reject(new Error(`Файл не найден: ${filePath}`));
        return;
      }

      const results = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          results.push(data);
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 РЕЗУЛЬТАТЫ ВАЛИДАЦИИ');
    console.log('='.repeat(60));

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('\n✅ Все файлы полностью валидны! Можно начинать импорт.');
      console.log('\n💡 Рекомендация:');
      console.log('   Запустите скрипт импорта:');
      console.log('   node import_stripe_your_format.js');
    } else {
      if (this.warnings.length > 0) {
        console.log('\n⚠️  ПРЕДУПРЕЖДЕНИЯ:');
        this.warnings.forEach((warning, index) => {
          console.log(`   ${index + 1}. ${warning}`);
        });
      }

      if (this.errors.length > 0) {
        console.log('\n🚨 КРИТИЧЕСКИЕ ОШИБКИ:');
        this.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
        console.log('\n❌ Исправьте ошибки перед импортом!');
      } else {
        console.log('\n✅ Критических ошибок нет, но есть предупреждения.');
        console.log(
          '\n💡 Вы можете продолжить импорт, но проверьте предупреждения.'
        );
      }
    }

    console.log('='.repeat(60));
  }
}

// Запуск валидации
async function main() {
  try {
    console.log('🚀 Запуск валидации вашего формата импорта...\n');

    // Проверяем наличие файлов
    const files = [
      './stripe/imports/products.csv',
      './stripe/imports/prices.csv',
    ];
    const missingFiles = files.filter((file) => !fs.existsSync(file));

    if (missingFiles.length > 0) {
      console.error('❌ Отсутствуют файлы:');
      missingFiles.forEach((file) => console.error(`   - ${file}`));
      console.error(
        '\n💡 Убедитесь, что файлы находятся в текущей директории.'
      );
      process.exit(1);
    }

    const validator = new CSVValidatorYourFormat();
    const isValid = await validator.validateAll();

    if (!isValid) {
      console.log(
        '\n🔴 Валидация не пройдена. Исправьте ошибки и запустите снова.'
      );
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Ошибка валидации:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Проверяем, запущен ли скрипт напрямую
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}

export default CSVValidatorYourFormat;
