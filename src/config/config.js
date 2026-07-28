import { env } from './env.validation.js';
import { Logger } from './logger.js';
import { CloudinaryService } from './cloudinary.js';

class Config {
  // App
  NODE_ENV = env.NODE_ENV || 'development';
  PORT = env.PORT;
  API_URL = env.API_URL;
  CLIENT_URL = env.CLIENT_URLS?.[0] || 'http://localhost:5173';

  // Database
  DATABASE_URL = env.DATABASE_URL;

  // JWT
  JWT_TOKEN = env.JWT_TOKEN;
  JWT_REFRESH_TOKEN = env.JWT_REFRESH_TOKEN;
  JWT_TOKEN_EXPIRES_IN = env.JWT_TOKEN_EXPIRES_IN || '30d';
  JWT_REFRESH_TOKEN_EXPIRES_IN = env.JWT_REFRESH_TOKEN_EXPIRES_IN || '30d';
  // Redis
  REDIS_URL = env.REDIS_URL;
  BACKEND_URL = env.BACKEND_URL || `http://localhost:${env.PORT || 5000}`;

  // SMTP
  SMTP_HOST = env.SMTP_HOST;
  SMTP_PORT = env.SMTP_PORT;
  SMTP_USER = env.SMTP_USER;
  SMTP_PASS = env.SMTP_PASS;
  SMTP_FROM = env.SMTP_FROM || env.SMTP_USER;

  // Cloudinary
  CLOUD_NAME = env.CLOUDINARY_NAME;
  CLOUD_API_KEY = env.CLOUDINARY_API_KEY;
  CLOUD_API_SECRET = env.CLOUDINARY_SECRET;
  // google translate
  GOOGLE_TRANSLATE_API_KEY = env.GOOGLE_TRANSLATE_API_KEY;
  // Stripe
  STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  STRIPE_PUBLISHABLE_KEY = env.STRIPE_PUBLISHABLE_KEY;
  STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

  // Admin
  ADMIN_EMAIL = env.ADMIN_EMAIL;
  ADMIN_PASSWORD = env.ADMIN_PASSWORD;
  logger;
  cloudinary;

  constructor() {
    this.logger = new Logger('Config');
    this.cloudinary = new CloudinaryService(
      env.CLOUDINARY_NAME,
      env.CLOUDINARY_API_KEY,
      env.CLOUDINARY_SECRET,
    );
  }

  initialize() {
    try {
      if (env.CLOUDINARY_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_SECRET) {
        this.cloudinary.init();
      }
      this.logger.info(' Configuration initialized', {
        env: this.NODE_ENV,
        port: this.PORT,
      });
    } catch (error) {
      this.logger.error('Failed to initialize config', error);
      throw error;
    }
  }

  validateRequired() {
    const required = ['JWT_TOKEN', 'JWT_REFRESH_TOKEN', 'DATABASE_URL'];
    const missing = required.filter((key) => !this[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required config: ${missing.join(', ')}`);
    }
    return true;
  }

  getApiBaseUrl() {
    return (this.API_URL || this.BACKEND_URL || `http://localhost:${this.PORT}`).replace(/\/$/, '');
  }
}

export const config = new Config();
