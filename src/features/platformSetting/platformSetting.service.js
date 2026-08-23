import { prisma } from '../../config/db.js';
import { config } from '../../config/config.js';
import { MaintenanceModeError } from '../../shared/globals/helpers/error-handler.js';
import { Logger } from '../../config/logger.js';
import { expandI18nFromEnglish } from '../../shared/services/translate/translate.service.js';
import { smsService } from '../../shared/services/sms/sms.service.js';
import {
    DEFAULT_BRAND_SETTINGS,
    DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
    DEFAULT_EMAIL_TEMPLATES,
    EMAIL_TEMPLATE_PLACEHOLDERS,
    DEFAULT_PLATFORM_SETTINGS,
    DEFAULT_WEBHOOK_ENDPOINTS,
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
            stripeEnabled: settings.stripeEnabled,
            paypalEnabled: settings.paypalEnabled,
            applePayEnabled: settings.applePayEnabled,
            googlePayEnabled: settings.googlePayEnabled,
            defaultCurrency: settings.defaultCurrency,
            defaultTaxRate: settings.defaultTaxRate,
            platformName: settings.platformName || DEFAULT_BRAND_SETTINGS.platformName,
            primaryColor: settings.primaryColor || DEFAULT_BRAND_SETTINGS.primaryColor,
            platformLogoUrl: settings.platformLogoUrl || null,
        };
    }

    async getFinancialSettings() {
        const settings = await this.getSettings();

        return {
            currency: settings.defaultCurrency,
            taxRate: settings.defaultTaxRate,
            stripeEnabled: settings.stripeEnabled,
            paypalEnabled: settings.paypalEnabled,
            applePayEnabled: settings.applePayEnabled,
            googlePayEnabled: settings.googlePayEnabled,
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async updateFinancialSettings(payload, userId) {
        const settings = await this.getSettings();
        const stripeEnabled = payload.stripeEnabled ?? settings.stripeEnabled;
        const paypalEnabled = payload.paypalEnabled ?? settings.paypalEnabled;

        if (!stripeEnabled && !paypalEnabled) {
            throw new Error('At least one payment gateway must remain enabled.');
        }

        const data = {};

        if (payload.currency !== undefined) data.defaultCurrency = payload.currency.toUpperCase();
        if (payload.taxRate !== undefined) data.defaultTaxRate = payload.taxRate;
        if (payload.stripeEnabled !== undefined) data.stripeEnabled = payload.stripeEnabled;
        if (payload.paypalEnabled !== undefined) data.paypalEnabled = payload.paypalEnabled;
        if (payload.applePayEnabled !== undefined) data.applePayEnabled = payload.applePayEnabled;
        if (payload.googlePayEnabled !== undefined) data.googlePayEnabled = payload.googlePayEnabled;

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                ...data,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`Financial settings updated by ${userId}`, data);

        return updated;
    }

    _mergeEmailTemplates(stored, locale = 'it') {
        const storedMap = stored && typeof stored === 'object' ? stored : {};

        return Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([key, defaults]) => {
            const override = storedMap[key] || {};
            const merged = {
                ...defaults,
                ...override,
                id: key,
            };

            return {
                ...merged,
                label: this._resolveLocalizedText(merged.name, locale) || key,
                subjectText: this._resolveLocalizedText(merged.subject, locale) || '',
                bodyHtmlText: this._resolveLocalizedText(merged.bodyHtml, locale) || '',
                subjectEn: merged.subject?.en || merged.subject?.it || '',
                bodyHtmlEn: merged.bodyHtml?.en || merged.bodyHtml?.it || '',
                placeholders: EMAIL_TEMPLATE_PLACEHOLDERS[key] || [],
            };
        });
    }

    async _normalizeEmailTemplateUpdate(templateUpdate = {}) {
        const normalized = { ...templateUpdate };

        if (typeof templateUpdate.subject === 'string' && templateUpdate.subject.trim()) {
            normalized.subject = await expandI18nFromEnglish(templateUpdate.subject.trim(), { html: false });
        }

        if (typeof templateUpdate.bodyHtml === 'string' && templateUpdate.bodyHtml.trim()) {
            normalized.bodyHtml = await expandI18nFromEnglish(templateUpdate.bodyHtml.trim(), { html: true });
        }

        return normalized;
    }

    _resolveSmtpConfig(settings) {
        return {
            host: settings.smtpHost || config.SMTP_HOST || '',
            port: Number(settings.smtpPort ?? config.SMTP_PORT ?? 587),
            fromEmail: settings.smtpFromEmail || config.SMTP_FROM || config.SMTP_USER || '',
            user: config.SMTP_USER || '',
            pass: (config.SMTP_PASS || '').replace(/\s+/g, ''),
        };
    }

    async getSmtpConfig() {
        const settings = await this.getSettings();
        return this._resolveSmtpConfig(settings);
    }

    async getSystemSettings(locale = 'it') {
        const settings = await this.getSettings();
        const smtp = this._resolveSmtpConfig(settings);

        return {
            smtpHost: smtp.host,
            smtpPort: smtp.port,
            smtpFromEmail: smtp.fromEmail,
            smtpConfigured: Boolean(smtp.host && smtp.user && smtp.pass),
            emailTemplates: this._mergeEmailTemplates(settings.emailTemplates, locale),
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async updateSystemSettings(payload, userId) {
        const settings = await this.getSettings();
        const data = {};

        if (payload.smtpHost !== undefined) data.smtpHost = payload.smtpHost || null;
        if (payload.smtpPort !== undefined) data.smtpPort = payload.smtpPort ?? null;
        if (payload.smtpFromEmail !== undefined) data.smtpFromEmail = payload.smtpFromEmail || null;

        if (payload.emailTemplates !== undefined) {
            const current = settings.emailTemplates && typeof settings.emailTemplates === 'object'
                ? settings.emailTemplates
                : {};

            const mergedTemplates = { ...current };
            for (const [templateId, templateUpdate] of Object.entries(payload.emailTemplates)) {
                mergedTemplates[templateId] = {
                    ...(current[templateId] || {}),
                    ...(await this._normalizeEmailTemplateUpdate(templateUpdate)),
                };
            }

            data.emailTemplates = mergedTemplates;
        }

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                ...data,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`System settings updated by ${userId}`, data);

        return updated;
    }

    async testSmtpConnection(locale = 'it') {
        const smtp = await this.getSmtpConfig();

        if (!smtp.host || !smtp.user || !smtp.pass) {
            throw new Error('SMTP is not fully configured. Set host in admin settings and credentials in server environment.');
        }

        const nodemailer = (await import('nodemailer')).default;
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: {
                user: smtp.user,
                pass: smtp.pass,
            },
            requireTLS: smtp.port === 587,
        });

        await transporter.verify();

        return {
            host: smtp.host,
            port: smtp.port,
            fromEmail: smtp.fromEmail,
            verifiedAt: new Date().toISOString(),
            message: locale === 'it'
                ? 'Connessione SMTP verificata con successo'
                : 'SMTP connection verified successfully',
        };
    }

    async getBrandSettings() {
        const settings = await this.getSettings();

        return {
            platformName: settings.platformName || DEFAULT_BRAND_SETTINGS.platformName,
            primaryColor: settings.primaryColor || DEFAULT_BRAND_SETTINGS.primaryColor,
            platformLogoUrl: settings.platformLogoUrl || null,
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async updateBrandSettings(payload, userId) {
        const data = {};

        if (payload.platformName !== undefined) data.platformName = payload.platformName.trim();
        if (payload.primaryColor !== undefined) data.primaryColor = payload.primaryColor;
        if (payload.platformLogoUrl !== undefined) data.platformLogoUrl = payload.platformLogoUrl || null;

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                ...data,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`Brand settings updated by ${userId}`, data);

        return updated;
    }

    _mergeWebhookEndpoints(stored, locale = 'it') {
        const storedMap = stored && typeof stored === 'object' ? stored : {};

        return Object.entries(DEFAULT_WEBHOOK_ENDPOINTS).map(([key, defaults]) => {
            const override = storedMap[key] || {};
            const merged = {
                ...defaults,
                ...override,
                id: key,
            };
            const enabled = merged.enabled !== false;

            return {
                id: key,
                event: merged.event,
                name: this._resolveLocalizedText(merged.name, locale) || key,
                enabled,
                url: merged.url || '',
                status: enabled ? 'Active' : 'Inactive',
            };
        });
    }

    async getWebhookSettings(locale = 'it') {
        const settings = await this.getSettings();

        return {
            webhooks: this._mergeWebhookEndpoints(settings.webhookEndpoints, locale),
            sms: smsService.getStatus(),
            updatedAt: settings.updatedAt,
            updatedById: settings.updatedById,
        };
    }

    async testSmsConnection({ to, body } = {}, locale = 'it') {
        const message = body?.trim()
            || (locale === 'it'
                ? 'Test SMS UnoSicurezza: Twilio e configurato correttamente.'
                : 'UnoSicurezza SMS test: Twilio is configured correctly.');

        const result = await smsService.sendSms({ to, body: message });

        return {
            ...result,
            message: locale === 'it'
                ? `SMS di test inviato a ${result.to}`
                : `Test SMS sent to ${result.to}`,
        };
    }

    async updateWebhookSettings(payload, userId) {
        const settings = await this.getSettings();
        const current = settings.webhookEndpoints && typeof settings.webhookEndpoints === 'object'
            ? settings.webhookEndpoints
            : {};

        const merged = { ...current };

        for (const [webhookId, webhookUpdate] of Object.entries(payload.webhooks || {})) {
            if (!DEFAULT_WEBHOOK_ENDPOINTS[webhookId]) {
                throw new Error(`Unknown webhook endpoint: ${webhookId}`);
            }

            const next = {
                ...(current[webhookId] || {}),
                ...webhookUpdate,
            };

            if (webhookUpdate.url !== undefined) {
                next.url = webhookUpdate.url ? String(webhookUpdate.url).trim() : '';
            }

            if (next.enabled && next.url) {
                try {
                    const parsed = new URL(next.url);
                    if (!['http:', 'https:'].includes(parsed.protocol)) {
                        throw new Error('Webhook URL must use http or https');
                    }
                } catch {
                    throw new Error(`Invalid webhook URL for "${webhookId}"`);
                }
            }

            merged[webhookId] = next;
        }

        const updated = await prisma.platformSetting.update({
            where: { id: 'global' },
            data: {
                webhookEndpoints: merged,
                updatedById: userId,
            },
        });

        this._invalidateCache();
        log.info(`Webhook settings updated by ${userId}`, payload.webhooks);

        return updated;
    }

    async assertStripeEnabled() {
        const settings = await this.getSettings();
        if (!settings.stripeEnabled) {
            throw new Error('Stripe payments are disabled by the platform administrator.');
        }
        return settings;
    }

    async assertPayPalEnabled() {
        const settings = await this.getSettings();
        if (!settings.paypalEnabled) {
            throw new Error('PayPal payments are disabled by the platform administrator.');
        }
        return settings;
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
