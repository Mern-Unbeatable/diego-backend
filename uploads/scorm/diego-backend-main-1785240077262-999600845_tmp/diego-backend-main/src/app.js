import { config } from './config/config.js';
import express from 'express';
import { Server } from './server.js';
import { Logger } from './config/logger.js';

export class Application {
  constructor() {
    this.logger = new Logger('Application');
    this.app = express();
    this.server = new Server(this.app);

    this.loadConfig();
    this.server.configure();

    if (config.NODE_ENV !== 'test') {
      Application.handleExit(this.logger);
    }
  }

  build() {
    return this.app;
  }

  start() {
    try {
      this.server.start();
    } catch (error) {
      this.logger.error('Failed to start application', error);
      process.exit(1);
    }
  }

  loadConfig() {
    try {
      config.initialize();
      config.validateRequired();
      this.logger.info('Configuration loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load configuration', error);
      process.exit(1);
    }
  }

  static handleExit(logger) {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', {
        error: error.message,
        stack: error.stack,
      });
      Application.shutDownProperly(logger, 1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.error('UNHANDLED REJECTION! 💥 Shutting down...', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      Application.shutDownProperly(logger, 1);
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logger.warn('👋 SIGTERM received. Shutting down gracefully');
      Application.shutDownProperly(logger, 0);
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.warn('👋 SIGINT received. Shutting down gracefully');
      Application.shutDownProperly(logger, 0);
    });
  }

  static shutDownProperly(logger, exitCode) {
    // Add cleanup logic here (close DB connections, etc.)
    Promise.resolve()
      .then(async () => {
        // Close database connections if needed
        // await prisma.$disconnect();
        logger.info('Cleanup completed');
      })
      .catch((error) => {
        logger.error('Error during cleanup', error);
      })
      .finally(() => {
        logger.info('Shutdown complete');
        process.exit(exitCode);
      });
  }
}