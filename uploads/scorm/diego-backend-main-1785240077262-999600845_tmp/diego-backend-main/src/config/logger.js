import winston from 'winston';

export class Logger {
  constructor(serviceName) {
    const env = process.env.NODE_ENV || 'development';
    const isProd = env === 'production';

    this.winston = winston.createLogger({
      level: isProd ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        isProd
          ? winston.format.json()
          : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, stack, context }) => {
              const ctx = context ? ` [${context}]` : '';
              return `[${timestamp}] ${level}${ctx}: ${stack || message}`;
            }),
          ),
      ),
      defaultMeta: { service: serviceName },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ],
    });
  }

  info(message, meta) {
    this.winston.info(message, meta);
  }

  error(message, error, context) {
    const err = error instanceof Error ? error : undefined;

    this.winston.error(message, {
      context,
      stack: err?.stack,
      ...(error && !(error instanceof Error) ? { detail: error } : {}),
    });
  }

  warn(message, meta) {
    this.winston.warn(message, meta);
  }

  debug(message, meta) {
    this.winston.debug(message, meta);
  }

  // HTTP request logger
  http(message, meta) {
    this.winston.http(message, meta);
  }
}