// helpers.js - Complete version with all required methods

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../../config/config.js';

export class Helpers {
  // Password hashing methods
  static hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  static comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  // Token generation methods
  static generateAccessToken(payload) {
    return jwt.sign(payload, config.JWT_TOKEN, {
      expiresIn: config.JWT_TOKEN_EXPIRES_IN || '30d',
    });
  }

  static generateRefreshToken(payload) {
    return jwt.sign(payload, config.JWT_REFRESH_TOKEN, {
      expiresIn: config.JWT_REFRESH_TOKEN_EXPIRES_IN || '30d', // 30 days for refresh token
    });
  }

  // Token verification methods
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.JWT_TOKEN);
    } catch (error) {
      return null;
    }
  }

  static verifyRefreshToken(token) {
    try {
      return jwt.verify(token, config.JWT_REFRESH_TOKEN);
    } catch (error) {
      return null;
    }
  }

  // Password reset token methods
  static generatePasswordResetToken(payload) {
    return jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        type: 'password-reset',
      },
      config.JWT_TOKEN,
      { expiresIn: '1h' },
    );
  }

  static verifyPasswordResetToken(token) {
    try {
      const decoded = jwt.verify(token, config.JWT_TOKEN);
      if (decoded.type && decoded.type !== 'password-reset') {
        return null;
      }
      return decoded;
    } catch (error) {
      return null;
    }
  }

  // Temporary reset token for OTP flow (10 minutes)
  static generateTempResetToken(payload) {
    return jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        type: 'temp-reset',
      },
      config.JWT_TOKEN,
      { expiresIn: '10m' }
    );
  }

  static verifyTempResetToken(token) {
    try {
      const decoded = jwt.verify(token, config.JWT_TOKEN);
      if (decoded.type && decoded.type !== 'temp-reset') {
        return null;
      }
      return decoded;
    } catch (error) {
      return null;
    }
  }

  // Registration token (30 minutes)
  static generateRegistrationToken(payload) {
    return jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        type: 'registration',
      },
      config.JWT_TOKEN,
      { expiresIn: '30m' },
    );
  }

  static verifyRegistrationToken(token) {
    try {
      const decoded = jwt.verify(token, config.JWT_TOKEN);
      if (decoded.type !== 'registration') {
        return null;
      }
      return decoded;
    } catch (error) {
      return null;
    }
  }

  // Email verification token
  static generateEmailVerificationToken(payload) {
    return jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        type: 'email-verification',
      },
      config.JWT_TOKEN,
      { expiresIn: '24h' },
    );
  }

  static verifyEmailVerificationToken(token) {
    try {
      const decoded = jwt.verify(token, config.JWT_TOKEN);
      if (decoded.type !== 'email-verification') {
        return null;
      }
      return decoded;
    } catch (error) {
      return null;
    }
  }

  // Generic token verification with type check
  static verifyToken(token, expectedType = null) {
    try {
      const decoded = jwt.verify(token, config.JWT_TOKEN);
      if (expectedType && decoded.type !== expectedType) {
        return null;
      }
      return decoded;
    } catch (error) {
      return null;
    }
  }

  // Decode token without verification (for debugging)
  static decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch (error) {
      return null;
    }
  }

  // Get token expiration time
  static getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded?.exp ? new Date(decoded.exp * 1000) : null;
    } catch (error) {
      return null;
    }
  }

  // Check if token is expired
  static isTokenExpired(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded?.exp) return true;
      return Date.now() >= decoded.exp * 1000;
    } catch (error) {
      return true;
    }
  }
}