import HTTP_STATUS from 'http-status-codes';
import jwt from 'jsonwebtoken';
import { config } from '../../../config/config.js';
import { platformSettingService } from '../../../features/platformSetting/platformSetting.service.js';

const MAINTENANCE_BYPASS_PREFIXES = [
    '/health',
    '/api/v1/platform-settings/status',
    '/api/v1/auth',
];

const getRequestPath = (req) => req.originalUrl?.split('?')[0] || req.path || '';

const isBypassPath = (path) => MAINTENANCE_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));

const extractUserLevel = (req) => {
    if (req.user?.level) return req.user.level;

    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
        token = req.cookies.accessToken;
    }

    if (!token) return null;

    try {
        const payload = jwt.verify(token, config.JWT_TOKEN);
        return payload.level || null;
    } catch {
        return null;
    }
};

export const maintenanceModeMiddleware = async (req, res, next) => {
    try {
        const requestPath = getRequestPath(req);

        if (isBypassPath(requestPath)) {
            return next();
        }

        const settings = await platformSettingService.getSettings();
        if (!platformSettingService.isMaintenanceMode(settings)) {
            return next();
        }

        const userLevel = extractUserLevel(req);
        if (userLevel === 'PLATFORM_ADMIN') {
            return next();
        }

        const locale = req.locale || 'it';

        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
            status: 'error',
            statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
            message: platformSettingService.getMaintenanceMessage(settings, locale),
            data: {
                maintenanceModeEnabled: true,
            },
        });
    } catch (error) {
        return next(error);
    }
};
