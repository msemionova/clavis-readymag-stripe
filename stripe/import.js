import fs from 'fs';
import csv from 'csv-parser';
import { exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';

const execAsync = promisify(exec);

class StripeImporterYourFormat {
  constructor() {
    this.stats = {
      products: { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
      prices: { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
    };
    this.errors = [];
  }

  async importAll() {
    console.log('🚀 Запуск импорта данных Stripe (ваш формат)...\n');

    // 1. Читаем данные
    console.log('📖 Чтение CSV файлов...');
    const products = await this.readCSV('./stripe/imports/products.csv');
    const prices = await this.readCSV('./stripe/imports/prices.csv');

    this.stats.products.total = products.length;
    this.stats.prices.total = prices.length;

    console.log(`   Найдено продуктов: ${products.length}`);
    console.log(`   Найдено цен: ${prices.length}\n`);

    // 2. Запрашиваем подтверждение
    await this.confirmImport();

    // 3. Импортируем продукты
    console.log('\n📦 ИМПОРТ ПРОДУКТОВ:');
    for (const product of products) {
      await this.importProduct(product);
    }

    // 4. Импортируем цены
    console.log('\n💰 ИМПОРТ ЦЕН:');
    for (const price of prices) {
      await this.importPrice(price);
    }

    // 5. Выводим результаты
    this.printResults();
  }

  async importProduct(product) {
    try {
      console.log(`   Обработка продукта: ${product.id} - ${product.name}`);

      // Подготавливаем метаданные для вашего формата
      const metadata = this.prepareProductMetadata(product);

      // Проверяем существует ли продукт
      const exists = await this.checkProductExists(product.id);

      if (exists) {
        console.log(`     ⚠️  Продукт уже существует, обновляем...`);
        await this.updateProduct(product, metadata);
        this.stats.products.updated++;
      } else {
        console.log(`     ➕ Создаем новый продукт...`);
        await this.createProduct(product, metadata);
        this.stats.products.created++;
      }
    } catch (error) {
      console.error(`     ❌ Ошибка: ${error.message}`);
      this.stats.products.failed++;
      this.errors.push(`Продукт ${product.id}: ${error.message}`);
    }
  }

  async importPrice(price) {
    try {
      console.log(
        `   Обработка цены: ${price['Price ID']} - ${price.Description}`
      );

      // Подготавливаем данные цены
      const priceData = this.preparePriceData(price);

      // Проверяем существует ли цена
      const exists = await this.checkPriceExists(price['Price ID']);

      if (exists) {
        console.log(`     ⚠️  Цена уже существует, пропускаем...`);
        this.stats.prices.skipped++;
      } else {
        console.log(`     ➕ Создаем новую цену...`);
        await this.createPrice(price['Product ID'], priceData);
        this.stats.prices.created++;
      }
    } catch (error) {
      console.error(`     ❌ Ошибка: ${error.message}`);
      this.stats.prices.failed++;
      this.errors.push(`Цена ${price['Price ID']}: ${error.message}`);
    }
  }

  prepareProductMetadata(product) {
    const metadata = {};

    // Извлекаем все метаданные из вашего формата
    Object.keys(product).forEach((key) => {
      if (key.startsWith('metadata[') && key.endsWith(']')) {
        const metaKey = key.substring(9, key.length - 1); // Убираем 'metadata[' и ']'
        metadata[metaKey] = product[key];
      }
    });

    return metadata;
  }

  preparePriceData(price) {
    // Конвертируем Amount из "178,20" в 17820 (центы)
    const amountStr = price.Amount.toString().replace(',', '.');
    const amount = Math.round(parseFloat(amountStr) * 100);

    // Подготавливаем метаданные для цены
    const metadata = {};

    // Извлекаем метаданные из вашего формата
    Object.keys(price).forEach((key) => {
      if (key.includes('(metadata)')) {
        const metaKey = key.replace(' (metadata)', '');
        metadata[metaKey] = price[key];
      }
    });

    // Формируем параметры для Stripe CLI
    const params = [
      `--unit-amount=${amount}`,
      `--currency=${price.Currency.toLowerCase()}`,
      `product=${price['Product ID']}`,
    ];

    // Добавляем опциональные поля
    if (price.Description) {
      params.push(`--nickname="${price.Description}"`);
    }

    // Добавляем метаданные
    if (Object.keys(metadata).length > 0) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value) {
          params.push(`--metadata-${key}="${value}"`);
        }
      });
    }

    // Добавляем Tax Behavior если есть
    if (price['Tax Behavior'] && price['Tax Behavior'] !== 'unspecified') {
      params.push(`--tax-behavior=${price['Tax Behavior']}`);
    }

    return params.join(' ');
  }

  async checkProductExists(productId) {
    try {
      await execAsync(`stripe products retrieve ${productId}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkPriceExists(priceId) {
    try {
      await execAsync(`stripe prices retrieve ${priceId}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async createProduct(product, metadata) {
    const params = [
      `--id=${product.id}`,
      `--name="${product.name}"`,
      `--active=${product.active || 'true'}`,
    ];

    if (product.description) {
      params.push(`--description="${product.description}"`);
    }

    // Добавляем изображение если есть
    if (product.images) {
      // images может быть строкой с URL или массивом в JSON
      try {
        const images = JSON.parse(product.images);
        if (Array.isArray(images) && images.length > 0) {
          params.push(`--images="${images[0]}"`);
        }
      } catch {
        // Если не JSON, то это может быть прямая ссылка
        if (product.images.startsWith('http')) {
          params.push(`--images="${product.images}"`);
        }
      }
    }

    // Добавляем метаданные
    if (Object.keys(metadata).length > 0) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value) {
          params.push(`--metadata-${key}="${value}"`);
        }
      });
    }

    const command = `stripe products create ${params.join(' ')}`;
    await this.executeStripeCommand(command, 'продукт');
  }

  async updateProduct(product, metadata) {
    const params = [];

    if (product.name) {
      params.push(`--name="${product.name}"`);
    }

    if (product.description !== undefined) {
      params.push(`--description="${product.description}"`);
    }

    if (product.active !== undefined) {
      params.push(`--active=${product.active}`);
    }

    // Добавляем метаданные
    if (Object.keys(metadata).length > 0) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value) {
          params.push(`--metadata-${key}="${value}"`);
        }
      });
    }

    if (params.length > 0) {
      const command = `stripe products update ${product.id} ${params.join(
        ' '
      )}`;
      await this.executeStripeCommand(command, 'продукт');
    }
  }

  async createPrice(productId, priceParams) {
    const command = `stripe prices create ${priceParams}`;
    await this.executeStripeCommand(command, 'цену');
  }

  async executeStripeCommand(command, entity) {
    try {
      console.log(`     🛠️  Выполняем: ${command.substring(0, 100)}...`);
      const { stdout, stderr } = await execAsync(command);

      if (stderr && !stderr.includes('Warning:')) {
        throw new Error(stderr);
      }

      console.log(`     ✅ ${entity} успешно обработан`);
      return stdout;
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`     ⚠️  ${entity} уже существует`);
        return null;
      }
      throw error;
    }
  }

  async confirmImport() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(
        `\nВы собираетесь импортировать:\n` +
          `📦 ${this.stats.products.total} продуктов\n` +
          `💰 ${this.stats.prices.total} цен\n\n` +
          `⚠️  ВНИМАНИЕ: Существующие данные будут обновлены!\n` +
          `Продолжить? (yes/no): `,
        (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'yes') {
            console.log('❌ Импорт отменен');
            process.exit(0);
          }
          resolve();
        }
      );
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
    console.log('📊 РЕЗУЛЬТАТЫ ИМПОРТА');
    console.log('='.repeat(60));

    console.log('\n📦 ПРОДУКТЫ:');
    console.log(`   Всего: ${this.stats.products.total}`);
    console.log(`   Создано: ${this.stats.products.created}`);
    console.log(`   Обновлено: ${this.stats.products.updated}`);
    console.log(`   Пропущено: ${this.stats.products.skipped}`);
    console.log(`   Ошибок: ${this.stats.products.failed}`);

    console.log('\n💰 ЦЕНЫ:');
    console.log(`   Всего: ${this.stats.prices.total}`);
    console.log(`   Создано: ${this.stats.prices.created}`);
    console.log(`   Пропущено: ${this.stats.prices.skipped}`);
    console.log(`   Ошибок: ${this.stats.prices.failed}`);

    if (this.errors.length > 0) {
      console.log('\n🚨 ОШИБКИ:');
      this.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log(
      this.stats.products.failed + this.stats.prices.failed === 0
        ? '✅ ИМПОРТ ЗАВЕРШЕН УСПЕШНО!'
        : '⚠️  ИМПОРТ ЗАВЕРШЕН С ОШИБКАМИ'
    );
    console.log('='.repeat(60));
  }
}

// Запуск импорта
async function main() {
  try {
    // Проверяем наличие файлов
    if (
      !fs.existsSync('./stripe/imports/products.csv') ||
      !fs.existsSync('./stripe/imports/prices.csv')
    ) {
      console.error('❌ Отсутствуют файлы products.csv или prices.csv');
      console.error('💡 Убедитесь, что файлы находятся в текущей директории');
      process.exit(1);
    }

    const importer = new StripeImporterYourFormat();
    await importer.importAll();
  } catch (error) {
    console.error('❌ Критическая ошибка импорта:', error.message);
    process.exit(1);
  }
}

// Проверяем, запущен ли скрипт напрямую
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}

export default StripeImporterYourFormat;
