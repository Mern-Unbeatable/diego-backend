import { json, urlencoded } from 'express';
import http from 'http';
import path from 'path';

import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import HTTP_STATUS from 'http-status-codes';
import apiStats from 'swagger-stats';
import express from 'express';
import { ZodError } from 'zod';

import { config } from './config/config.js';
import applicationRoutes from './routes/index.js';
import { Logger } from './config/logger.js';
import { CustomError } from './shared/globals/helpers/error-handler.js';
import { maintenanceModeMiddleware } from './shared/globals/helpers/platform-setting.middleware.js';

const flattenZodIssues = (issues) => {
  const collected = [];

  const walk = (issue) => {
    if (!issue) return;

    if (issue.code === 'invalid_union') {
      // Zod v3: issue.unionErrors (array of ZodError)
      if (Array.isArray(issue.unionErrors)) {
        issue.unionErrors.forEach((unionError) => {
          if (Array.isArray(unionError.issues)) {
            unionError.issues.forEach(walk);
          }
        });
        return;
      }

      // Zod v4: issue.errors (array of issue arrays)
      if (Array.isArray(issue.errors)) {
        issue.errors.forEach((branchIssues) => {
          if (Array.isArray(branchIssues)) {
            branchIssues.forEach(walk);
          }
        });
      }
      return;
    }

    collected.push(issue);
  };

  issues.forEach(walk);

  // Keep only unique field+message pairs to avoid duplicate noise from union branches.
  const unique = new Set();
  return collected.filter((issue) => {
    const key = `${issue.path.join('.')}::${issue.message}`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
};

export class Server {
  constructor(app) {
    this.app = app;
    this.log = new Logger('Server');
    this.isConfigured = false;
  }

  start() {
    this.configure();
    void this.startServer(this.app);
  }

  configure() {
    if (this.isConfigured) return;
    this.securityMiddleware(this.app);

    this.standardMiddleware(this.app);
    this.routesMiddleware(this.app);
    this.apiMonitoring(this.app);
    this.globalErrorHandler(this.app);
    this.isConfigured = true;
  }

  securityMiddleware(app) {
    app.set('trust proxy', 1);
    app.use(hpp());

    app.use(
      helmet({
        // SCORM HTML is embedded in the LMS frontend iframe (different port/origin).
        frameguard: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      }),
    );

    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      "https://diego.maktechgroup.tech"
    ];

    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);

          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }

          if (
            process.env.NODE_ENV === 'development'
            && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
          ) {
            return callback(null, true);
          }

          return callback(new Error(`CORS blocked: ${origin}`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        optionsSuccessStatus: 200,
      }),
    );
  }

  standardMiddleware(app) {
    app.use(compression());
    app.use(json({ limit: '50mb' }));

    // Catch malformed/empty JSON bodies immediately, before they reach routes
    app.use((err, _req, res, next) => {
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          status: 'error',
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: 'Invalid JSON in request body',
        });
      }
      next(err);
    });

    app.use(urlencoded({ extended: true, limit: '50mb' }));


    const uploadRoots = [
      path.join(process.cwd(), 'uploads'),
      path.join(process.cwd(), 'src', 'uploads'),
    ];

    const allowScormIframeEmbedding = (_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "frame-ancestors 'self' http://localhost:5173 http://localhost:5174 https://diego.maktechgroup.tech",
      );
      next();
    };

    // Serve locally uploaded files (courses/thumbnails, SCORM packages, etc.)
    app.use('/uploads', allowScormIframeEmbedding);
    for (const uploadRoot of uploadRoots) {
      app.use('/uploads', express.static(uploadRoot, {
        maxAge: config.NODE_ENV === 'production' ? '7d' : 0,
        fallthrough: true,
      }));
    }

    app.use((req, _res, next) => {
      this.log.http(`${req.method} ${req.originalUrl}`);
      next();
    });
  }

  routesMiddleware(app) {
    app.use(maintenanceModeMiddleware);
    applicationRoutes(app);
  }

  apiMonitoring(app) {
    if (config.NODE_ENV === 'test') return;
    app.use(apiStats.getMiddleware({ uriPath: '/api-monitoring' }));
  }

  globalErrorHandler(app) {
    app.use((req, res) => {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        status: 'error',
        statusCode: HTTP_STATUS.NOT_FOUND,
        message: `${req.originalUrl} not found`,
      });
    });

    app.use((error, _req, res, _next) => {
      this.log.error('Global error handler', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });

      if (error instanceof ZodError) {
        const issues = flattenZodIssues(error.issues);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          status: 'error',
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: 'Validation failed',
          errors: issues.map((issue) => ({
            field: issue.path.join('.') || 'unknown',
            message: issue.message,
          })),
        });
      }

      if (error instanceof CustomError) {
        return res.status(error.statusCode).json(error.serializeErrors());
      }

      if (error.name === 'JsonWebTokenError') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          status: 'error',
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          message: 'Invalid authentication token',
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          status: 'error',
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          message: 'Authentication token expired',
        });
      }

      if (error.code === 'P2002') {
        return res.status(HTTP_STATUS.CONFLICT).json({
          status: 'error',
          statusCode: HTTP_STATUS.CONFLICT,
          message: 'A record with this value already exists',
        });
      }

      if (error.code === 'P2025') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          status: 'error',
          statusCode: HTTP_STATUS.NOT_FOUND,
          message: 'Record not found',
        });
      }

      if (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1017') {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          status: 'error',
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          message: 'Database connection failed. Check DATABASE_URL and ensure the database server is reachable.',
        });
      }

      const message = error?.message || '';
      if (error instanceof Error && !(error instanceof CustomError)) {
        const devStack = config.NODE_ENV !== 'production' ? { stack: error.stack } : {};

        if (/authentication required|access token|invalid token/i.test(message)) {
          return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'error',
            statusCode: HTTP_STATUS.UNAUTHORIZED,
            message,
            ...devStack,
          });
        }

        if (/permission denied|not active|not the teacher/i.test(message)) {
          return res.status(HTTP_STATUS.FORBIDDEN).json({
            status: 'error',
            statusCode: HTTP_STATUS.FORBIDDEN,
            message,
            ...devStack,
          });
        }

        if (/not found/i.test(message)) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({
            status: 'error',
            statusCode: HTTP_STATUS.NOT_FOUND,
            message,
            ...devStack,
          });
        }

        if (
          /required|cannot be empty|invalid|already enrolled|expired|suspended|locked|overlap|no seats/i.test(message)
        ) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            status: 'error',
            statusCode: HTTP_STATUS.BAD_REQUEST,
            message,
            ...devStack,
          });
        }
      }

      const isProduction = config.NODE_ENV === 'production';
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message: isProduction ? error.message || 'Internal server error' : error.message,
        ...(config.NODE_ENV !== 'production' ? { stack: error.stack } : {}),
      });
    });
  }

  async startServer(app) {
    if (!config.JWT_TOKEN) throw new Error('JWT_TOKEN must be provided');
    try {
      const httpServer = new http.Server(app);
      this.startHttpServer(httpServer);
    } catch (error) {
      this.log.error('Failed to start server', error);
      process.exit(1);
    }
  }

  startHttpServer(httpServer) {
    this.log.info(`Worker started (PID: ${process.pid})`);
    httpServer.listen(config.PORT, () => {
      this.log.info(`LMS server running on port ${config.PORT}`);
      this.log.info(`Environment: ${config.NODE_ENV}`);
    });
    httpServer.on('error', (error) => {
      this.log.error('HTTP server error', error);
      if (error.code === 'EADDRINUSE') {
        this.log.error(`Port ${config.PORT} is already in use`);
        process.exit(1);
      }
    });
  }
}
