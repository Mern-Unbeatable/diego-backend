import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import {
    DEFAULT_PLATFORM_SETTINGS,
    EMERGENCY_CONTROL_LABELS,
    PLATFORM_SETTING_KEYS,
} from './platformSetting.constants.js';

const log = new Logger('PlatformSettingService');
const CACHE_TTL_MS = 30_000;

class PlatformSettingService {
    constructor() {
        this._cache = null;
        this._cacheAt = 0;
    }

    _invalidateCache() {
        this._cache = null;
        this._cacheAt = 0;
    }

    async ensureDefaults() {
        return prisma.platformSetting.upsert({
            where: { id: 'global' },
            update: {},
            create: { id: 'global', ...DEFAULT_PLATFORM_SETTINGS },
        });
    }

    async getSettings({ fresh = false } = {}) {
        const now = Date.now();
        if (!fresh && this._cache && now - this._cacheAt < CACHE_TTL_MS) {
            return this._cache;
        }

        const settings = await this.ensureDefaults();
        this._cache = settings;
        this._cacheAt = now;
        return settings;
    }

    _formatControl(key, enabled, locale = 'it') {
        const meta = EMERGENCY_CONTROL_LABELS[key] || {};
        return {
            key,
            enabled,
            status: enabled ? 'ACTIVE' : 'INACTIVE',
            title: meta.title?.[locale] || meta.title?.en || key,
            description: meta.description?.[locale] || meta.description?.en || '',
        };
    }

    async getEmergencyControls(locale = 'it') {
        const settings = await this.getSettings();

        return {
            controls: [
                this._formatControl(PLATFORM_SETTING_KEYS.DOWNLOAD_PERMISSION, settings.downloadPermissionEnabled, locale),
                this._formatControl(PLATFORM_SETTING_KEYS.NEW_USER_REGISTRATION, settings.newUserRegistrationEnabled, locale),
                this._formatControl(PLATFORM_SETTING_KEYS.PAYMENT_PROCESSING, settings.paymentProcessingEnabled, locale),
                this._formatControl(PLATFORM_SETTING_KEYS.MAINTENANCE_MODE, settings.maintenanceModeEnabled, locale),
            ],
            maintenanceMessage: settings.maintenanceMessage,
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async getPublicStatus(locale = 'it') {
        const settings = await this.getSettings();

        return {
            maintenanceModeEnabled: settings.maintenanceModeEnabled,
            maintenanceMessage: settings.maintenanceMessage?.[locale]
                || settings.maintenanceMessage?.en
                || settings.maintenanceMessage?.it
                || null,
            downloadPermissionEnabled: settings.downloadPermissionEnabled,
            newUserRegistrationEnabled: settings.newUserRegistrationEnabled,
            paymentProcessingEnabled: settings.paymentProcessingEnabled,
        };
    }

    async updateEmergencyControls(payload, userId) {
        const allowedFields = [
            'downloadPermissionEnabled',
            'newUserRegistrationEnabled',
            'paymentProcessingEnabled',
            'maintenanceModeEnabled',
            'maintenanceMessage',
        ];

        const data = {};
        for (const field of allowedFields) {
            if (payload[field] !== undefined) {
                data[field] = payload[field];
            }
        }

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                ...data,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`Emergency controls updated by ${userId}`, data);

        return updated;
    }

    async assertEnabled(settingKey, errorMessage) {
        const settings = await this.getSettings();
        if (!settings[settingKey]) {
            throw new Error(errorMessage);
        }
        return settings;
    }

    async assertDownloadAllowed() {
        return this.assertEnabled(
            PLATFORM_SETTING_KEYS.DOWNLOAD_PERMISSION,
            'Certificate downloads are temporarily disabled by the platform administrator.',
        );
    }

    async assertRegistrationAllowed() {
        return this.assertEnabled(
            PLATFORM_SETTING_KEYS.NEW_USER_REGISTRATION,
            'New user registration is temporarily disabled by the platform administrator.',
        );
    }

    async assertPaymentAllowed() {
        return this.assertEnabled(
            PLATFORM_SETTING_KEYS.PAYMENT_PROCESSING,
            'Payment processing is temporarily disabled by the platform administrator.',
        );
    }

    isMaintenanceMode(settings) {
        return Boolean(settings?.maintenanceModeEnabled);
    }
}

export const platformSettingService = new PlatformSettingService();
