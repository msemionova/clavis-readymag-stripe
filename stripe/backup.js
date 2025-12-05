import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_...');

class EnhancedStripeBackup {
  constructor() {
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.backupDir = join(__dirname, 'stripe-backups', this.timestamp);
    this.allData = {
      timestamp: new Date().toISOString(),
      account: null,
      products: [],
      prices: [],
      customers: [],
      subscriptions: [],
      paymentIntents: [],
    };
  }

  /**
   * Полный бэкап аккаунта Stripe
   */
  async backupAll() {
    console.log('💾 Создание ПОЛНОГО бэкапа Stripe...\n');

    try {
      // Создаем директорию
      this.ensureDirectory();

      // 1. Информация об аккаунте
      await this.backupAccount();

      // 2. Продукты
      await this.backupProducts();

      // 3. Цены
      await this.backupPrices();

      // 4. Клиенты (опционально)
      await this.backupCustomers();

      // 5. Подписки (опционально)
      await this.backupSubscriptions();

      // 6. Сохранение всех данных
      await this.saveAllData();

      // 7. Генерация CSV для импорта
      await this.generateImportCSV();

      // 8. Создание отчета
      this.generateReport();
    } catch (error) {
      console.error('❌ Ошибка при создании бэкапа:', error.message);
      await this.saveErrorLog(error);
      process.exit(1);
    }
  }

  /**
   * Создание директории для бэкапа
   */
  ensureDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      console.log(`📁 Создана директория: ${this.backupDir}`);
    }
  }

  /**
   * Бэкап информации об аккаунте
   */
  async backupAccount() {
    console.log('👤 Экспорт информации об аккаунте...');

    try {
      const account = await stripe.accounts.retrieve();
      this.allData.account = account;

      const accountPath = join(this.backupDir, 'account.json');
      fs.writeFileSync(accountPath, JSON.stringify(account, null, 2));

      console.log(`   ✅ Аккаунт: ${account.id}`);
    } catch (error) {
      console.log(`   ⚠️  Информация об аккаунте: ${error.message}`);
    }
  }

  /**
   * Бэкап всех продуктов
   */
  async backupProducts() {
    console.log('📦 Экспорт продуктов...');

    const allProducts = [];
    let hasMore = true;
    let startingAfter = null;

    try {
      while (hasMore) {
        const params = {
          limit: 100,
          active: true,
          expand: ['data.default_price'],
        };

        if (startingAfter) params.starting_after = startingAfter;

        const products = await stripe.products.list(params);
        allProducts.push(...products.data);

        hasMore = products.has_more;
        if (products.data.length > 0) {
          startingAfter = products.data[products.data.length - 1].id;
        }

        console.log(`   Загружено: ${allProducts.length} продуктов`);

        // Пауза для rate limit
        await this.sleep(100);
      }

      this.allData.products = allProducts;

      // Сохранение в JSON
      const jsonPath = join(this.backupDir, 'products.json');
      fs.writeFileSync(jsonPath, JSON.stringify(allProducts, null, 2));

      // Сохранение в CSV (формат для импорта)
      await this.saveProductsToCSV(allProducts);

      console.log(`   ✅ Всего продуктов: ${allProducts.length}`);
    } catch (error) {
      console.error(`   ❌ Ошибка экспорта продуктов: ${error.message}`);
      throw error;
    }
  }

  /**
   * Бэкап всех цен
   */
  async backupPrices() {
    console.log('💰 Экспорт цен...');

    const allPrices = [];
    let hasMore = true;
    let startingAfter = null;

    try {
      while (hasMore) {
        const params = {
          limit: 100,
          active: true,
          expand: ['data.product'],
        };

        if (startingAfter) params.starting_after = startingAfter;

        const prices = await stripe.prices.list(params);
        allPrices.push(...prices.data);

        hasMore = prices.has_more;
        if (prices.data.length > 0) {
          startingAfter = prices.data[prices.data.length - 1].id;
        }

        console.log(`   Загружено: ${allPrices.length} цен`);

        // Пауза для rate limit
        await this.sleep(100);
      }

      this.allData.prices = allPrices;

      // Сохранение в JSON
      const jsonPath = join(this.backupDir, 'prices.json');
      fs.writeFileSync(jsonPath, JSON.stringify(allPrices, null, 2));

      // Сохранение в CSV (формат для импорта)
      await this.savePricesToCSV(allPrices);

      console.log(`   ✅ Всего цен: ${allPrices.length}`);
    } catch (error) {
      console.error(`   ❌ Ошибка экспорта цен: ${error.message}`);
      throw error;
    }
  }

  /**
   * Бэкап клиентов (опционально)
   */
  async backupCustomers() {
    console.log('👥 Экспорт клиентов (опционально)...');

    try {
      const customers = await stripe.customers.list({ limit: 50 });
      this.allData.customers = customers.data;

      if (customers.data.length > 0) {
        const jsonPath = join(this.backupDir, 'customers.json');
        fs.writeFileSync(jsonPath, JSON.stringify(customers.data, null, 2));
        console.log(`   ✅ Клиентов: ${customers.data.length}`);
      } else {
        console.log(`   ℹ️  Клиентов нет или доступ ограничен`);
      }
    } catch (error) {
      console.log(`   ⚠️  Клиенты: ${error.message}`);
    }
  }

  /**
   * Бэкап подписок (опционально)
   */
  async backupSubscriptions() {
    console.log('🔄 Экспорт подписок (опционально)...');

    try {
      const subscriptions = await stripe.subscriptions.list({
        limit: 50,
        status: 'all',
      });
      this.allData.subscriptions = subscriptions.data;

      if (subscriptions.data.length > 0) {
        const jsonPath = join(this.backupDir, 'subscriptions.json');
        fs.writeFileSync(jsonPath, JSON.stringify(subscriptions.data, null, 2));
        console.log(`   ✅ Подписок: ${subscriptions.data.length}`);
      } else {
        console.log(`   ℹ️  Подписок нет`);
      }
    } catch (error) {
      console.log(`   ⚠️  Подписки: ${error.message}`);
    }
  }

  /**
   * Сохранение продуктов в CSV (ваш формат)
   */
  async saveProductsToCSV(products) {
    const csvWriter = createObjectCsvWriter({
      path: join(this.backupDir, 'products-import.csv'),
      header: [
        { id: 'id', title: 'ID' },
        { id: 'name', title: 'Name' },
        { id: 'description', title: 'Description' },
        { id: 'url', title: 'Url' },
        { id: 'tax_code', title: 'Tax Code' },
        { id: 'readymag_page', title: 'readymag_page (metadata)' },
        { id: 'camp_page', title: 'camp_page (metadata)' },
        { id: 'product_id', title: 'product_id (metadata)' },
        { id: 'title', title: 'title (metadata)' },
        { id: 'time_label', title: 'time_label (metadata)' },
        { id: 'camp_type', title: 'camp_type (metadata)' },
        { id: 'season', title: 'season (metadata)' },
        { id: 'discipline_label_en', title: 'discipline_label_en (metadata)' },
        { id: 'discipline_label_de', title: 'discipline_label_de (metadata)' },
        { id: 'week_label', title: 'week_label (metadata)' },
        { id: 'discipline_key', title: 'discipline_key (metadata)' },
        { id: 'period_label', title: 'period_label (metadata)' },
        { id: 'age_label', title: 'age_label (metadata)' },
        { id: 'original_price_id', title: 'original_price_id (metadata)' },
        { id: 'pricing', title: 'pricing (metadata)' },
        { id: 'slot', title: 'slot (metadata)' },
        { id: 'week', title: 'week (metadata)' },
        { id: 'childLast', title: 'childLast (metadata)' },
        { id: 'childFirst', title: 'childFirst (metadata)' },
      ],
    });

    const records = products.map((product) => {
      const metadata = product.metadata || {};

      // Форматирование даты
      const createdDate = new Date(product.created * 1000);
      const formattedDate = createdDate
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);

      return {
        id: product.id,
        name: product.name,
        description: product.description || '',
        url: product.url || '',
        tax_code: product.tax_code || '',
        readymag_page: metadata.readymag_page || '',
        camp_page: metadata.camp_page || '',
        product_id: metadata.product_id || '',
        title: metadata.title || '',
        time_label: metadata.time_label || '',
        camp_type: metadata.camp_type || '',
        season: metadata.season || '',
        discipline_label_en: metadata.discipline_label_en || '',
        discipline_label_de: metadata.discipline_label_de || '',
        week_label: metadata.week_label || '',
        discipline_key: metadata.discipline_key || '',
        period_label: metadata.period_label || '',
        age_label: metadata.age_label || '',
        original_price_id: metadata.original_price_id || '',
        pricing: metadata.pricing || '',
        slot: metadata.slot || '',
        week: metadata.week || '',
        childLast: metadata.childLast || '',
        childFirst: metadata.childFirst || '',
      };
    });

    await csvWriter.writeRecords(records);
    console.log(`   📄 CSV для импорта: products-import.csv`);
  }

  /**
   * Сохранение цен в CSV (ваш формат)
   */
  async savePricesToCSV(prices) {
    const csvWriter = createObjectCsvWriter({
      path: join(this.backupDir, 'prices-import.csv'),
      header: [
        { id: 'id', title: 'Price ID' },
        { id: 'product_id', title: 'Product ID' },
        { id: 'product_name', title: 'Product Name' },
        {
          id: 'product_statement_descriptor',
          title: 'Product Statement Descriptor',
        },
        { id: 'product_tax_code', title: 'Product Tax Code' },
        { id: 'description', title: 'Description' },
        { id: 'created', title: 'Created (UTC)' },
        { id: 'amount', title: 'Amount' },
        { id: 'currency', title: 'Currency' },
        { id: 'interval', title: 'Interval' },
        { id: 'interval_count', title: 'Interval Count' },
        { id: 'usage_type', title: 'Usage Type' },
        { id: 'aggregate_usage', title: 'Aggregate Usage' },
        { id: 'billing_scheme', title: 'Billing Scheme' },
        { id: 'trial_period_days', title: 'Trial Period Days' },
        { id: 'tax_behavior', title: 'Tax Behavior' },
        {
          id: 'full_day_discount_eur',
          title: 'full_day_discount_eur (metadata)',
        },
        { id: 'booked_seats', title: 'booked_seats (metadata)' },
        { id: 'max_seats', title: 'max_seats (metadata)' },
        { id: 'time_label', title: 'time_label (metadata)' },
        {
          id: 'time_label_afternoon',
          title: 'time_label_afternoon (metadata)',
        },
        { id: 'time_label_morning', title: 'time_label_morning (metadata)' },
        { id: 'week', title: 'week (metadata)' },
        { id: 'slot', title: 'slot (metadata)' },
        { id: 'discount', title: 'discount (metadata)' },
      ],
    });

    const records = prices.map((price) => {
      const metadata = price.metadata || {};

      // Форматирование даты
      const createdDate = new Date(price.created * 1000);
      const formattedDate = createdDate
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);

      // Форматирование суммы (евро с запятой)
      const formattedAmount = price.unit_amount
        ? (price.unit_amount / 100).toFixed(2).replace('.', ',')
        : '0,00';

      // Получение имени продукта
      let productName = '';
      if (typeof price.product === 'object' && price.product.name) {
        productName = price.product.name;
      }

      return {
        id: price.id,
        product_id:
          typeof price.product === 'string' ? price.product : price.product.id,
        product_name: productName,
        product_statement_descriptor: '',
        product_tax_code: '',
        description: price.nickname || '',
        created: formattedDate,
        amount: formattedAmount,
        currency: price.currency,
        interval: price.recurring?.interval || '',
        interval_count: price.recurring?.interval_count || '',
        usage_type: price.recurring?.usage_type || '',
        aggregate_usage: price.recurring?.aggregate_usage || '',
        billing_scheme: price.billing_scheme || '',
        trial_period_days: price.recurring?.trial_period_days || '',
        tax_behavior: price.tax_behavior || '',
        full_day_discount_eur: metadata.full_day_discount_eur || '',
        booked_seats: metadata.booked_seats || '',
        max_seats: metadata.max_seats || '',
        time_label: metadata.time_label || '',
        time_label_afternoon: metadata.time_label_afternoon || '',
        time_label_morning: metadata.time_label_morning || '',
        week: metadata.week || '',
        slot: metadata.slot || '',
        discount: metadata.discount || '',
      };
    });

    await csvWriter.writeRecords(records);
    console.log(`   📄 CSV для импорта: prices-import.csv`);
  }

  /**
   * Сохранение всех данных в один файл
   */
  async saveAllData() {
    const allDataPath = join(this.backupDir, 'stripe-complete-backup.json');
    fs.writeFileSync(allDataPath, JSON.stringify(this.allData, null, 2));

    console.log(`\n💾 Полный бэкап сохранен: stripe-complete-backup.json`);
  }

  /**
   * Генерация CSV для импорта в правильном формате
   */
  async generateImportCSV() {
    console.log('\n🔄 Генерация CSV для импорта...');

    // Продукты в формате Stripe
    await this.generateStripeFormatProductsCSV();

    // Цены в формате Stripe
    await this.generateStripeFormatPricesCSV();

    console.log('   ✅ CSV файлы для импорта созданы');
  }

  /**
   * Продукты в формате Stripe CSV импорта
   */
  async generateStripeFormatProductsCSV() {
    const records = this.allData.products.map((product) => {
      const record = {
        id: product.id,
        object: 'product',
        active: product.active,
        attributes: product.attributes?.join(',') || '',
        caption: '',
        'deactivate_on[]': '',
        description: product.description || '',
        images: product.images?.join(';') || '',
        name: product.name,
        package_dimensions: '',
        shippable: '',
        statement_descriptor: product.statement_descriptor || '',
        tax_code: product.tax_code || '',
        unit_label: product.unit_label || '',
        url: product.url || '',
      };

      // Добавляем метаданные
      Object.entries(product.metadata || {}).forEach(([key, value]) => {
        record[`metadata[${key}]`] = value;
      });

      return record;
    });

    if (records.length > 0) {
      const headers = Object.keys(records[0]);
      const csvContent = [
        headers.join(','),
        ...records.map((record) =>
          headers.map((header) => `"${record[header]}"`).join(',')
        ),
      ].join('\n');

      fs.writeFileSync(
        join(this.backupDir, 'stripe-products-import.csv'),
        csvContent
      );
    }
  }

  /**
   * Цены в формате Stripe CSV импорта
   */
  async generateStripeFormatPricesCSV() {
    const records = this.allData.prices.map((price) => {
      const record = {
        id: price.id,
        object: 'price',
        active: price.active,
        billing_scheme: price.billing_scheme,
        currency: price.currency,
        'custom_unit_amount[minimum]': '',
        'custom_unit_amount[maximum]': '',
        'custom_unit_amount[preset]': '',
        lookup_key: price.lookup_key || '',
        nickname: price.nickname || '',
        product:
          typeof price.product === 'string'
            ? price.product
            : price.product?.id || '',
        'recurring[aggregate_usage]': price.recurring?.aggregate_usage || '',
        'recurring[interval]': price.recurring?.interval || '',
        'recurring[interval_count]': price.recurring?.interval_count || '',
        'recurring[usage_type]': price.recurring?.usage_type || '',
        tax_behavior: price.tax_behavior,
        tiers_mode: price.tiers_mode || '',
        'transform_quantity[divide_by]': '',
        'transform_quantity[round]': '',
        type: price.type,
        unit_amount: price.unit_amount || '',
        unit_amount_decimal: price.unit_amount_decimal || '',
      };

      // Добавляем метаданные
      Object.entries(price.metadata || {}).forEach(([key, value]) => {
        record[`metadata[${key}]`] = value;
      });

      return record;
    });

    if (records.length > 0) {
      const headers = Object.keys(records[0]);
      const csvContent = [
        headers.join(','),
        ...records.map((record) =>
          headers
            .map((header) => {
              const value = record[header];
              return value !== undefined && value !== null ? `"${value}"` : '';
            })
            .join(',')
        ),
      ].join('\n');

      fs.writeFileSync(
        join(this.backupDir, 'stripe-prices-import.csv'),
        csvContent
      );
    }
  }

  /**
   * Сохранение лога ошибок
   */
  async saveErrorLog(error) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      backupData: {
        productsCount: this.allData.products.length,
        pricesCount: this.allData.prices.length,
      },
    };

    const errorPath = join(this.backupDir, 'error-log.json');
    fs.writeFileSync(errorPath, JSON.stringify(errorLog, null, 2));
    console.log(`💾 Лог ошибки сохранен: ${errorPath}`);
  }

  /**
   * Генерация отчета
   */
  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 ОТЧЕТ ПОЛНОГО БЭКАПА STRIPE');
    console.log('='.repeat(60));

    console.log(`\n📁 Директория бэкапа: ${this.backupDir}`);
    console.log(`🕒 Время создания: ${new Date().toLocaleString()}`);

    console.log('\n📊 СТАТИСТИКА:');
    console.log(`   📦 Продуктов: ${this.allData.products.length}`);
    console.log(`   💰 Цен: ${this.allData.prices.length}`);
    console.log(`   👥 Клиентов: ${this.allData.customers.length}`);
    console.log(`   🔄 Подписок: ${this.allData.subscriptions.length}`);

    console.log('\n💾 СОХРАНЕННЫЕ ФАЙЛЫ:');

    const files = [
      { name: 'stripe-complete-backup.json', desc: 'Полный бэкап в JSON' },
      { name: 'products.json', desc: 'Все продукты (JSON)' },
      { name: 'prices.json', desc: 'Все цены (JSON)' },
      {
        name: 'products-import.csv',
        desc: 'Продукты для импорта (ваш формат)',
      },
      { name: 'prices-import.csv', desc: 'Цены для импорта (ваш формат)' },
      {
        name: 'stripe-products-import.csv',
        desc: 'Продукты для импорта Stripe',
      },
      { name: 'stripe-prices-import.csv', desc: 'Цены для импорта Stripe' },
    ];

    files.forEach((file) => {
      const filePath = join(this.backupDir, file.name);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(
          `   ✅ ${file.name} (${this.formatFileSize(stats.size)}) - ${
            file.desc
          }`
        );
      }
    });

    if (this.allData.account) {
      console.log(`\n👤 ИНФОРМАЦИЯ ОБ АККАУНТЕ:`);
      console.log(`   ID: ${this.allData.account.id}`);
      console.log(`   Email: ${this.allData.account.email || 'не указан'}`);
      console.log(`   Страна: ${this.allData.account.country}`);
    }

    console.log('\n🎉 Бэкап успешно завершен!');
    console.log('\n💡 Для восстановления используйте:');
    console.log('   1. Ваш формат: products-import.csv и prices-import.csv');
    console.log(
      '   2. Формат Stripe: stripe-products-import.csv и stripe-prices-import.csv'
    );
    console.log('   3. Полный JSON: stripe-complete-backup.json');
  }

  /**
   * Форматирование размера файла
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Пауза
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Скрипт для быстрого бэкапа по требованию
 */
async function quickBackup() {
  console.log('🚀 Быстрый бэкап текущих данных...\n');

  try {
    const backup = new EnhancedStripeBackup();
    await backup.backupAll();

    // Создаем симлинк на последний бэкап
    const latestLink = join(__dirname, 'stripe-backups', 'latest');
    try {
      if (fs.existsSync(latestLink)) {
        fs.unlinkSync(latestLink);
      }
      fs.symlinkSync(backup.backupDir, latestLink, 'dir');
      console.log(`\n🔗 Ссылка на последний бэкап: ${latestLink}`);
    } catch (err) {
      // Игнорируем ошибки симлинков на Windows
    }
  } catch (error) {
    console.error('❌ Ошибка при создании бэкапа:', error.message);
    process.exit(1);
  }
}

/**
 * Функция восстановления из бэкапа
 */
async function restoreFromBackup(backupPath) {
  console.log('🔄 Восстановление из бэкапа...');

  const backupDir = backupPath || join(__dirname, 'stripe-backups', 'latest');

  if (!fs.existsSync(backupDir)) {
    console.error(`❌ Директория бэкапа не найдена: ${backupDir}`);
    console.log('Доступные бэкапы:');
    const backupsDir = join(__dirname, 'stripe-backups');
    if (fs.existsSync(backupsDir)) {
      const backups = fs
        .readdirSync(backupsDir)
        .filter((item) => item !== 'latest')
        .sort()
        .reverse();

      backups.forEach((backup, index) => {
        console.log(`   ${index + 1}. ${backup}`);
      });
    }
    process.exit(1);
  }

  console.log(`📂 Восстановление из: ${backupDir}`);
  // Здесь будет логика восстановления
}

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === 'restore') {
    const backupPath = process.argv[3];
    restoreFromBackup(backupPath);
  } else if (command === 'list') {
    listBackups();
  } else {
    quickBackup();
  }
}

/**
 * Список доступных бэкапов
 */
function listBackups() {
  const backupsDir = join(__dirname, 'stripe-backups');

  if (!fs.existsSync(backupsDir)) {
    console.log('📭 Бэкапов не найдено');
    return;
  }

  const backups = fs
    .readdirSync(backupsDir)
    .filter((item) => item !== 'latest')
    .sort()
    .reverse();

  console.log('📚 Доступные бэкапы:');

  if (backups.length === 0) {
    console.log('   Нет бэкапов');
    return;
  }

  backups.forEach((backup, index) => {
    const backupPath = join(backupsDir, backup);
    const stats = fs.statSync(backupPath);
    const size = fs.readdirSync(backupPath).reduce((total, file) => {
      const filePath = join(backupPath, file);
      const fileStats = fs.statSync(filePath);
      return total + fileStats.size;
    }, 0);

    console.log(`\n   ${index + 1}. ${backup}`);
    console.log(`      📅 ${new Date(stats.birthtime).toLocaleString()}`);
    console.log(`      📊 ${formatFileSize(size)}`);

    // Показываем содержимое
    const files = fs.readdirSync(backupPath);
    console.log(`      📄 Файлы: ${files.join(', ')}`);
  });
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
