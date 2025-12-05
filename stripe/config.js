import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  // API ключ Stripe (тестовый режим)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_...',

  // Пути к файлам
  PRODUCTS_CSV_PATH: join(__dirname, './imports/products.csv'),
  PRICES_CSV_PATH: join(__dirname, './imports/prices.csv'),

  // Директории
  BACKUP_DIR: join(__dirname, 'backups'),
  LOGS_DIR: join(__dirname, 'logs'),

  // Настройки импорта
  RATE_LIMIT_DELAY: 100, // мс между запросами
  BATCH_SIZE: 20, // размер батча перед паузой

  // Дополнительные настройки
  DRY_RUN: process.env.STRIPE_DRY_RUN === 'true',
  UPDATE_EXISTING: false, // true = обновлять существующие
};
