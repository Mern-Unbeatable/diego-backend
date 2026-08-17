import jwt from 'jsonwebtoken';
import { prisma } from '../../../config/db.js';
import { config } from '../../../config/config.js';
import { ForbiddenError } from './error-handler.js';

const LICENSE_BYPASS_PREFIXES = [
    '/health',
    '/api/v1/auth',
    '/api/v1/platform-settings',
    '/api/v1/licenses/plans',
    '/api/v1/licenses/my',
    '/api/v1/licenses/checkout',
    '/api/v1/licenses/renewal',
    '/api/v1/licenses/verify-payment',
    '/api/v1/users/me',
    '/api/v1/tickets',
    '/api/v1/payments',
];

export class LicenseExpiredError extends ForbiddenError {
    constructor(message = 'Your license has expired. Please renew to continue.') {
        super(message);
        this.name = 'LicenseExpiredError';
        this.code = 'LICENSE_EXPIRED';
    }
}

export class LicenseSuspendedError extends ForbiddenError {
    constructor(message = 'Your license is suspended. Please contact support.') {
        super(message);
        this.name = 'LicenseSuspendedError';
        this.code = 'LICENSE_SUSPENDED';
    }
}

const getRequestPath = (req) => req.originalUrl?.split('?')[0] || req.path || '';

const isBypassPath = (path) =>
    LICENSE_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));

const extractUserIdAndLevel = (req) => {
    if (req.user?.id) {
        return {
            userId: req.user.id,
            level: req.user.level ?? req.user.role ?? null,
        };
    }

    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
        token = req.cookies.accessToken;
    }

    if (!token) return { userId: null, level: null };

    try {
        const payload = jwt.verify(token, config.JWT_TOKEN);
        return {
            userId: payload.id ?? null,
            level: payload.level ?? null,
        };
    } catch {
        return { userId: null, level: null };
    }
};

export const requireActiveLicense = async (req, res, next) => {
    try {
        const requestPath = getRequestPath(req);

        if (isBypassPath(requestPath)) {
            return next();
        }

        const { userId, level } = extractUserIdAndLevel(req);

        if (!userId || level !== 'LICENSE_USER') {
            return next();
        }

        const license = await prisma.license.findUnique({
            where: { userId },
            select: { expiresAt: true, isSuspended: true },
        });

        if (!license) {
            return next(new LicenseExpiredError('No active license found. Please purchase or renew your license.'));
        }

        if (license.isSuspended) {
            return next(new LicenseSuspendedError());
        }

        if (license.expiresAt < new Date()) {
            return next(new LicenseExpiredError());
        }

        return next();
    } catch (error) {
        return next(error);
    }
};
