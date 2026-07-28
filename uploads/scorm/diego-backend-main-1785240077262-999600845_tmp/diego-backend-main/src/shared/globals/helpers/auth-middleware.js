// import { Logger } from "../../../config/logger.js";
// import jwt from 'jsonwebtoken';
// import { config } from "../../../config/config.js";
// import { UnauthorizedError, NotFoundError, ForbiddenError } from "./error-handler.js";
// import { authService } from "../../../features/auth/auth.services.js";

// const ROLE_ALIAS_MAP = {
//   MASTER_ADMIN: 'PLATFORM_ADMIN',
//   PLATFORM_ADMIN: 'PLATFORM_ADMIN',
//   ADMIN: 'PLATFORM_ADMIN',
//   USER: 'PRIVATE_USER',
// };

// class AuthMiddleware {
//   constructor() {
//     this.log = new Logger('AuthMiddleware');
//   }

//   _normalizeRole(roleOrLevel) {
//     if (!roleOrLevel || typeof roleOrLevel !== 'string') return roleOrLevel;
//     return ROLE_ALIAS_MAP[roleOrLevel] ?? roleOrLevel;
//   }

//   protect = async (req, _res, next) => {
//     try {
//       let token;
//       if (req.headers.authorization?.startsWith('Bearer ')) {
//         token = req.headers.authorization.split(' ')[1];
//       }

//       if (!token && req.cookies?.accessToken) {
//         token = req.cookies.accessToken;
//       }

//       if (!token) {
//         throw new UnauthorizedError('Access token missing');
//       }

//       let payload;

//       try {
//         payload = jwt.verify(token, config.JWT_TOKEN);
//       } catch (err) {
//         if (err.name === 'TokenExpiredError') {
//           throw new UnauthorizedError('Token expired. Please refresh your token.');
//         }
//         if (err.name === 'JsonWebTokenError') {
//           throw new UnauthorizedError('Invalid token format');
//         }
//         throw new UnauthorizedError('Authentication failed');
//       }

//       const userId = payload.id;

//       if (!userId) {
//         throw new UnauthorizedError('Invalid token payload');
//       }

//       let user = await authService.getUserById(userId);

//       if (!user) {
//         throw new NotFoundError('User not found');
//       }
//       const normalizedRole = this._normalizeRole(user.level ?? user.role ?? payload.level ?? payload.role);

//       const safeUser = {
//         id: user.id,
//         email: user.email,
//         role: normalizedRole,
//         level: user.level ?? payload.level ?? null,
//         consentGiven: user.consentGiven,
//         preferredLanguage: user.preferredLanguage,
//         status: user.status,
//         companyId: user.companyId ?? null,
//         tenantId: user.tenantId ?? null,
//       };

//       req.user = safeUser;
//       this.log.debug(`User authenticated: ${userId} with role: ${safeUser.role}`);

//       next();
//     } catch (error) {
//       next(error);
//     }
//   };

//   authorize = (...allowedRoles) => {
//     return (req, _res, next) => {
//       if (!req.user) {
//         return next(new UnauthorizedError('Authentication required'));
//       }

//       const normalizedAllowedRoles = allowedRoles.map((role) => this._normalizeRole(role));
//       const currentRole = this._normalizeRole(req.user.role ?? req.user.level);

//       if (!normalizedAllowedRoles.includes(currentRole)) {
//         this.log.warn(`Access denied for user ${req.user.id} with role ${currentRole}. Required roles: ${allowedRoles.join(', ')}`);
//         return next(new ForbiddenError(`Access denied. ${allowedRoles.join(' or ')} role required.`));
//       }

//       this.log.debug(`User ${req.user.id} authorized with role ${currentRole}`);
//       next();
//     };
//   };

//   isAdmin = (req, _res, next) => {
//     if (!req.user) {
//       return next(new UnauthorizedError('Authentication required'));
//     }

//     const currentRole = this._normalizeRole(req.user.role ?? req.user.level);
//     if (currentRole !== 'PLATFORM_ADMIN') {
//       this.log.warn(`Admin access denied for user ${req.user.id} with role ${currentRole}`);
//       return next(new ForbiddenError('Admin access required'));
//     }

//     this.log.debug(`Admin access granted for user ${req.user.id}`);
//     next();
//   };
//   isUser = (req, _res, next) => {
//     if (!req.user) {
//       return next(new UnauthorizedError('Authentication required'));
//     }

//     const currentRole = this._normalizeRole(req.user.role ?? req.user.level);
//     if (currentRole !== 'PRIVATE_USER' && currentRole !== 'PLATFORM_ADMIN') {
//       return next(new ForbiddenError('User access required'));
//     }

//     next();
//   };

//   optionalAuth = async (req, _res, next) => {
//     try {
//       let token;

//       if (req.headers.authorization?.startsWith('Bearer ')) {
//         token = req.headers.authorization.split(' ')[1];
//       }

//       if (!token && req.cookies?.accessToken) {
//         token = req.cookies.accessToken;
//       }

//       if (token) {
//         try {
//           const payload = jwt.verify(token, config.JWT_TOKEN);
//           const userId = payload.id;

//           if (userId) {
//             const user = await authService.getUserById(userId);
//             if (user) {
//               req.user = {
//                 id: user.id,
//                 email: user.email,
//                 role: this._normalizeRole(user.level ?? user.role ?? payload.level ?? payload.role),
//                 level: user.level ?? payload.level ?? null,
//                 preferredLanguage: user.preferredLanguage,
//                 status: user.status,
//                 companyId: user.companyId ?? null,
//                 tenantId: user.tenantId ?? null,
//               };
//               this.log.debug(`Optional auth successful for user: ${userId}`);
//             }
//           }
//         } catch (err) {

//           this.log.debug('Optional auth: Invalid token provided');
//         }
//       }

//       next();
//     } catch (error) {
//       next(error);
//     }
//   };
// }

// export const authMiddleware = new AuthMiddleware();



import { Logger } from "../../../config/logger.js";
import jwt from 'jsonwebtoken';
import { config } from "../../../config/config.js";
import { UnauthorizedError, NotFoundError, ForbiddenError } from "./error-handler.js";
import { authService } from "../../../features/auth/auth.services.js";

const ROLE_ALIAS_MAP = {
  MASTER_ADMIN: 'PLATFORM_ADMIN',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  ADMIN: 'PLATFORM_ADMIN',
  USER: 'PRIVATE_USER',
};

class AuthMiddleware {
  constructor() {
    this.log = new Logger('AuthMiddleware');
  }

  _normalizeRole(roleOrLevel) {
    if (!roleOrLevel || typeof roleOrLevel !== 'string') return roleOrLevel;
    return ROLE_ALIAS_MAP[roleOrLevel] ?? roleOrLevel;
  }

  protect = async (req, _res, next) => {
    try {
      let token;
      if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
      }
      if (!token && req.cookies?.accessToken) {
        token = req.cookies.accessToken;
      }
      if (!token) throw new UnauthorizedError('Access token missing');

      let payload;
      try {
        payload = jwt.verify(token, config.JWT_TOKEN);
      } catch (err) {
        if (err.name === 'TokenExpiredError') throw new UnauthorizedError('Token expired. Please refresh your token.');
        if (err.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid token format');
        throw new UnauthorizedError('Authentication failed');
      }

      if (!payload.id) throw new UnauthorizedError('Invalid token payload');


      const user = await authService.getUserById(payload.id);
      if (!user) throw new NotFoundError('User not found');

      const normalizedRole = this._normalizeRole(user.level ?? user.role ?? payload.level ?? payload.role);

      req.user = {
        id: user.id,
        email: user.email,
        role: normalizedRole,
        level: user.level ?? payload.level ?? null,
        consentGiven: user.consentGiven,
        preferredLanguage: user.preferredLanguage,
        status: user.status,
        companyId: user.companyId ?? null,
        tenantId: user.tenantId ?? null,
      };

      this.log.debug(`Authenticated: ${user.id} | level: ${normalizedRole} | tenantId: ${user.tenantId}`);
      next();
    } catch (error) {
      next(error);
    }
  };

  authorize = (...allowedRoles) => {
    return (req, _res, next) => {
      if (!req.user) return next(new UnauthorizedError('Authentication required'));

      const normalizedAllowedRoles = allowedRoles.map((r) => this._normalizeRole(r));
      const currentRole = this._normalizeRole(req.user.role ?? req.user.level);

      if (!normalizedAllowedRoles.includes(currentRole)) {
        this.log.warn(`Access denied: ${req.user.id} (${currentRole}). Required: ${allowedRoles.join(', ')}`);
        return next(new ForbiddenError(`Access denied. ${allowedRoles.join(' or ')} role required.`));
      }

      next();
    };
  };

  isAdmin = (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    const currentRole = this._normalizeRole(req.user.role ?? req.user.level);
    if (currentRole !== 'PLATFORM_ADMIN') {
      return next(new ForbiddenError('Admin access required'));
    }
    next();
  };

  isUser = (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    const currentRole = this._normalizeRole(req.user.role ?? req.user.level);
    if (currentRole !== 'PRIVATE_USER' && currentRole !== 'PLATFORM_ADMIN') {
      return next(new ForbiddenError('User access required'));
    }
    next();
  };

  optionalAuth = async (req, _res, next) => {
    try {
      let token;
      if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
      }
      if (!token && req.cookies?.accessToken) {
        token = req.cookies.accessToken;
      }

      if (token) {
        try {
          const payload = jwt.verify(token, config.JWT_TOKEN);
          if (payload.id) {
            const user = await authService.getUserById(payload.id);
            if (user) {
              req.user = {
                id: user.id,
                email: user.email,
                role: this._normalizeRole(user.level ?? user.role ?? payload.level ?? payload.role),
                level: user.level ?? payload.level ?? null,
                preferredLanguage: user.preferredLanguage,
                status: user.status,
                companyId: user.companyId ?? null,
                tenantId: user.tenantId ?? null,
              };
            }
          }
        } catch (_) {
          this.log.debug('Optional auth: invalid token');
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authMiddleware = new AuthMiddleware();