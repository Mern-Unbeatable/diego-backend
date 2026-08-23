import dotenv from 'dotenv';
import { z } from 'zod';
import { Logger } from './logger.js';

dotenv.config();

const logger = new Logger('env-validation');

const emptyToUndefined = (value) => {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
};

const paypalModeSchema = z.preprocess((value) => {
  const text = emptyToUndefined(value);
  if (!text) return undefined;

  const normalized = text.replace(/['"]/g, '').toLowerCase();
  if (['local', 'dev', 'development', 'test'].includes(normalized)) return 'sandbox';
  if (['prod', 'production'].includes(normalized)) return 'live';
  return normalized;
}, z.enum(['sandbox', 'live']).optional().default('sandbox'));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),

    PORT: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((num) => !isNaN(num) && num > 0, {
        message: 'PORT must be a positive integer',
      }),

    API_URL: z.string().url(),
    DATABASE_URL: z.string().url(),

    JWT_TOKEN: z.string().min(32),
    JWT_REFRESH_TOKEN: z.string().min(32),
    JWT_TOKEN_EXPIRES_IN: z.string().optional(),
    JWT_REFRESH_TOKEN_EXPIRES_IN: z.string().optional(),

    CLIENT_URLS: z
      .string()
      .optional()
      .transform((val) => {
        if (!val) return null;
        return val.split(',').map((url) => url.trim());
      }),

    // Redis 
    REDIS_URL: z.string().optional(),
    BACKEND_URL: z.string().url().optional(),
    // Cloudinary —
    CLOUDINARY_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_SECRET: z.string().optional(),
    // SMTP
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z
      .string()
      .transform((val) => parseInt(val, 10))
      .optional(),
    SMTP_USER: z.string().email().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    // Legacy SMTP
    SENDER_EMAIL: z.string().email().optional(),
    SENDER_EMAIL_PASSWORD: z.string().optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY required'),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1, 'STRIPE_PUBLISHABLE_KEY required').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET required'),

    PAYPAL_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    PAYPAL_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    PAYPAL_MODE: paypalModeSchema,

    // google translate
    GOOGLE_TRANSLATE_API_KEY: z.string().min(1, 'GOOGLE_TRANSLATE_API_KEY required'),

    // Twilio SMS (optional — trial or production credentials)
    TWILIO_ACCOUNT_SID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TWILIO_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TWILIO_PHONE_NUMBER: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
    TWILIO_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TWILIO_API_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    // Admin
    ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email'),
    ADMIN_PASSWORD: z.string().min(6, 'ADMIN_PASSWORD must be at least 6 characters'),

  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      const hasSMTP =
        (data.SMTP_HOST && data.SMTP_USER && data.SMTP_PASS) ||
        (data.SENDER_EMAIL && data.SENDER_EMAIL_PASSWORD);
      const hasSendGrid = data.SENDGRID_API_KEY && data.SENDGRID_SENDER;

      if (!hasSMTP && !hasSendGrid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Production: Either SMTP or SendGrid must be configured',
          path: ['SMTP_HOST'],
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `- ${path}: ${issue.message}`;
  });
  const summary = `❌ Invalid environment variables:\n${issues.join('\n')}`;
  logger.error(summary);
  console.error(summary);
  process.exit(1);
}

export const env = parsed.data;
