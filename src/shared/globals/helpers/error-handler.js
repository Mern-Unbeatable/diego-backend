// src/shared/globals/helpers/error-handler.js
import HTTP_STATUS from 'http-status-codes';

const flattenZodIssues = (issues = []) => {
  const collected = [];

  const walk = (issue) => {
    if (!issue) return;

    if (issue.code === 'invalid_union') {
      // Zod v3 shape
      if (Array.isArray(issue.unionErrors)) {
        issue.unionErrors.forEach((unionError) => {
          if (Array.isArray(unionError.issues)) {
            unionError.issues.forEach(walk);
          }
        });
        return;
      }

      // Zod v4 shape
      if (Array.isArray(issue.errors)) {
        issue.errors.forEach((branchIssues) => {
          if (Array.isArray(branchIssues)) {
            branchIssues.forEach(walk);
          }
        });
        return;
      }
    }

    collected.push(issue);
  };

  issues.forEach(walk);

  const unique = new Set();
  return collected.filter((issue) => {
    const key = `${issue.path.join('.')}::${issue.message}`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
};

export class CustomError extends Error {
  constructor(message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    super(message);
    this.status = 'error';
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  serializeErrors() {
    return {
      status: this.status,
      statusCode: this.statusCode,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

export class BadRequestError extends CustomError {
  constructor(message = 'Bad Request') {
    super(message, HTTP_STATUS.BAD_REQUEST);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends CustomError {
  constructor(message = 'Resource not found') {
    super(message, HTTP_STATUS.NOT_FOUND);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends CustomError {
  constructor(message = 'Unauthorized access') {
    super(message, HTTP_STATUS.UNAUTHORIZED);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends CustomError {
  constructor(message = 'Forbidden access') {
    super(message, HTTP_STATUS.FORBIDDEN);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends CustomError {
  constructor(message = 'Validation failed', errors = null) {
    super(message, HTTP_STATUS.BAD_REQUEST);
    this.name = 'ValidationError';
    this.errors = errors;
  }

  serializeErrors() {
    return {
      status: this.status,
      statusCode: this.statusCode,
      message: this.message,
      errors: this.errors ?? [],
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

// ─── NEW: wraps a ZodError into a clean CustomError ──────────────
export class ZodValidationError extends CustomError {
  constructor(zodError) {
    super('Validation failed', HTTP_STATUS.BAD_REQUEST);
    this.name = 'ZodValidationError';
    const issues = flattenZodIssues(zodError.issues ?? zodError.errors ?? []);
    this.errors = issues.map((err) => ({
      field: err.path.join('.') || 'unknown',
      message: err.message,
    }));
  }

  serializeErrors() {
    return {
      status: this.status,
      statusCode: this.statusCode,
      message: this.message,
      errors: this.errors,
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

export class ConflictError extends CustomError {
  constructor(message = 'Resource already exists') {
    super(message, HTTP_STATUS.CONFLICT);
    this.name = 'ConflictError';
  }
}

export class DatabaseError extends CustomError {
  constructor(message = 'Database operation failed') {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    this.name = 'DatabaseError';
  }
}

export class RateLimitError extends CustomError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS);
    this.name = 'RateLimitError';
  }
}

export class TokenExpiredError extends UnauthorizedError {
  constructor(message = 'Token has expired') {
    super(message);
    this.name = 'TokenExpiredError';
    this.code = 'TOKEN_EXPIRED';
  }
}

export class TokenInvalidError extends UnauthorizedError {
  constructor(message = 'Invalid token') {
    super(message);
    this.name = 'TokenInvalidError';
    this.code = 'TOKEN_INVALID';
  }
}

export class PaymentRequiredError extends CustomError {
  constructor(message = 'Payment required') {
    super(message, HTTP_STATUS.PAYMENT_REQUIRED);
    this.name = 'PaymentRequiredError';
  }
}

export class MaintenanceModeError extends CustomError {
  constructor(message = 'The platform is currently under maintenance. Please try again later.') {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE);
    this.name = 'MaintenanceModeError';
  }

  serializeErrors() {
    return {
      status: this.status,
      statusCode: this.statusCode,
      message: this.message,
      data: {
        maintenanceModeEnabled: true,
      },
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

export class InsufficientCreditsError extends PaymentRequiredError {
  constructor(message = 'Insufficient credits') {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}
