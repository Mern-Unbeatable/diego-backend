import { prisma } from '../../config/db.js';
import { MaintenanceModeError } from '../../shared/globals/helpers/error-handler.js';
import { Logger } from '../../config/logger.js';
import {
    DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
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

    getMaintenanceMessage(settings, locale = 'it') {
        return settings?.maintenanceMessage?.[locale]
            || settings?.maintenanceMessage?.en
            || settings?.maintenanceMessage?.it
            || 'The platform is currently under maintenance. Please try again later.';
    }

    async assertLoginAllowed(user, locale = 'it') {
        const settings = await this.getSettings();

        if (!this.isMaintenanceMode(settings)) {
            return settings;
        }

        if (user?.level === 'PLATFORM_ADMIN') {
            return settings;
        }

        throw new MaintenanceModeError(this.getMaintenanceMessage(settings, locale));
    }

    _resolveLocalizedText(value, locale = 'it') {
        if (!value) return null;
        if (typeof value === 'string') return value;
        return value[locale] || value.en || value.it || Object.values(value)[0] || null;
    }

    getCertificateArchiveConfig(settings = null) {
        const source = settings || this._cache || DEFAULT_PLATFORM_SETTINGS;

        return {
            enabled: source.certificateArchiveEnabled ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveEnabled,
            name: source.certificateArchiveName ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveName,
            description: source.certificateArchiveDescription ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveDescription,
            priceEur: Number(source.certificateArchivePriceEur ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchivePriceEur),
            currency: source.certificateArchiveCurrency ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveCurrency,
            durationDays: source.certificateArchiveDurationDays ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveDurationDays,
            storageMb: source.certificateArchiveStorageMb ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchiveStorageMb,
            freeDownloadDays: source.certificateFreeDownloadDays ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateFreeDownloadDays,
            legalRetentionYears: source.certificateLegalRetentionYears ?? DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateLegalRetentionYears,
        };
    }

    async getCertificateArchivePlan(locale = 'it') {
        const settings = await this.getSettings();
        const config = this.getCertificateArchiveConfig(settings);

        return {
            enabled: config.enabled,
            name: this._resolveLocalizedText(config.name, locale),
            description: this._resolveLocalizedText(config.description, locale),
            priceEur: config.priceEur,
            currency: config.currency,
            durationDays: config.durationDays,
            storageMb: config.storageMb,
            freeDownloadDays: config.freeDownloadDays,
            legalRetentionYears: config.legalRetentionYears,
            localized: {
                name: config.name,
                description: config.description,
            },
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async getCertificateArchivePlanForAdmin(locale = 'it') {
        const settings = await this.getSettings();
        const plan = await this.getCertificateArchivePlan(locale);

        return {
            ...plan,
            defaults: DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
            raw: {
                enabled: settings.certificateArchiveEnabled,
                name: settings.certificateArchiveName,
                description: settings.certificateArchiveDescription,
                priceEur: Number(settings.certificateArchivePriceEur),
                currency: settings.certificateArchiveCurrency,
                durationDays: settings.certificateArchiveDurationDays,
                storageMb: settings.certificateArchiveStorageMb,
                freeDownloadDays: settings.certificateFreeDownloadDays,
                legalRetentionYears: settings.certificateLegalRetentionYears,
            },
        };
    }

    async updateCertificateArchivePlan(payload, userId) {
        const data = {};

        if (payload.enabled !== undefined) data.certificateArchiveEnabled = payload.enabled;
        if (payload.name !== undefined) data.certificateArchiveName = payload.name;
        if (payload.description !== undefined) data.certificateArchiveDescription = payload.description;
        if (payload.priceEur !== undefined) data.certificateArchivePriceEur = payload.priceEur;
        if (payload.currency !== undefined) data.certificateArchiveCurrency = payload.currency.toUpperCase();
        if (payload.durationDays !== undefined) data.certificateArchiveDurationDays = payload.durationDays;
        if (payload.storageMb !== undefined) data.certificateArchiveStorageMb = payload.storageMb;
        if (payload.freeDownloadDays !== undefined) data.certificateFreeDownloadDays = payload.freeDownloadDays;
        if (payload.legalRetentionYears !== undefined) data.certificateLegalRetentionYears = payload.legalRetentionYears;

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                ...data,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`Certificate archive plan updated by ${userId}`, data);

        return updated;
    }
}

export const platformSettingService = new PlatformSettingService();
