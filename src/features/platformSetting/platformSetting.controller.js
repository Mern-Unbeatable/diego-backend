import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { platformSettingService } from './platformSetting.service.js';
import { updateEmergencyControlsSchema, updateCertificateArchivePlanSchema, updateFinancialSettingsSchema, updateSystemSettingsSchema, updateBrandSettingsSchema, updateWebhookSettingsSchema, testSmsSchema } from './platformSetting.validation.js';

class PlatformSettingController {
    constructor() {
        this.log = new Logger('PlatformSettingController');
    }

    getPublicStatus = catchAsync(async (req, res) => {
        const status = await platformSettingService.getPublicStatus(req.locale);

        ResponseHandler.success(res, {
            message: 'Platform status fetched successfully',
            data: status,
        });
    });

    getEmergencyControls = catchAsync(async (req, res) => {
        const controls = await platformSettingService.getEmergencyControls(req.locale);

        ResponseHandler.success(res, {
            message: 'Emergency controls fetched successfully',
            data: controls,
        });
    });

    updateEmergencyControls = catchAsync(async (req, res) => {
        const payload = updateEmergencyControlsSchema.parse(req.body);
        const updated = await platformSettingService.updateEmergencyControls(payload, req.user.id);
        const controls = await platformSettingService.getEmergencyControls(req.locale);

        ResponseHandler.success(res, {
            message: 'Emergency controls updated successfully',
            data: {
                ...controls,
                raw: {
                    downloadPermissionEnabled: updated.downloadPermissionEnabled,
                    newUserRegistrationEnabled: updated.newUserRegistrationEnabled,
                    paymentProcessingEnabled: updated.paymentProcessingEnabled,
                    maintenanceModeEnabled: updated.maintenanceModeEnabled,
                    maintenanceMessage: updated.maintenanceMessage,
                    updatedAt: updated.updatedAt,
                },
            },
        });
    });

    getCertificateArchivePlan = catchAsync(async (req, res) => {
        const plan = await platformSettingService.getCertificateArchivePlanForAdmin(req.locale);

        ResponseHandler.success(res, {
            message: 'Certificate archive plan fetched successfully',
            data: plan,
        });
    });

    updateCertificateArchivePlan = catchAsync(async (req, res) => {
        const payload = updateCertificateArchivePlanSchema.parse(req.body);
        await platformSettingService.updateCertificateArchivePlan(payload, req.user.id);
        const plan = await platformSettingService.getCertificateArchivePlanForAdmin(req.locale);

        ResponseHandler.success(res, {
            message: 'Certificate archive plan updated successfully',
            data: plan,
        });
    });

    getFinancialSettings = catchAsync(async (req, res) => {
        const settings = await platformSettingService.getFinancialSettings();

        ResponseHandler.success(res, {
            message: 'Financial settings fetched successfully',
            data: settings,
        });
    });

    updateFinancialSettings = catchAsync(async (req, res) => {
        const payload = updateFinancialSettingsSchema.parse(req.body);
        await platformSettingService.updateFinancialSettings(payload, req.user.id);
        const settings = await platformSettingService.getFinancialSettings();

        ResponseHandler.success(res, {
            message: 'Financial settings updated successfully',
            data: settings,
        });
    });

    getSystemSettings = catchAsync(async (req, res) => {
        const settings = await platformSettingService.getSystemSettings(req.locale);

        ResponseHandler.success(res, {
            message: 'System settings fetched successfully',
            data: settings,
        });
    });

    updateSystemSettings = catchAsync(async (req, res) => {
        const payload = updateSystemSettingsSchema.parse(req.body);
        await platformSettingService.updateSystemSettings(payload, req.user.id);
        const settings = await platformSettingService.getSystemSettings(req.locale);

        ResponseHandler.success(res, {
            message: 'System settings updated successfully',
            data: settings,
        });
    });

    testSystemSmtp = catchAsync(async (req, res) => {
        const result = await platformSettingService.testSmtpConnection(req.locale);

        ResponseHandler.success(res, {
            message: result.message,
            data: result,
        });
    });

    getBrandSettings = catchAsync(async (req, res) => {
        const settings = await platformSettingService.getBrandSettings();

        ResponseHandler.success(res, {
            message: 'Brand settings fetched successfully',
            data: settings,
        });
    });

    updateBrandSettings = catchAsync(async (req, res) => {
        const payload = updateBrandSettingsSchema.parse(req.body);
        await platformSettingService.updateBrandSettings(payload, req.user.id);
        const settings = await platformSettingService.getBrandSettings();

        ResponseHandler.success(res, {
            message: 'Brand settings updated successfully',
            data: settings,
        });
    });

    uploadBrandLogo = catchAsync(async (req, res) => {
        const platformLogoUrl = req.body.platformLogoUrl;
        if (!platformLogoUrl) {
            throw new Error('No logo file uploaded');
        }

        await platformSettingService.updateBrandSettings({ platformLogoUrl }, req.user.id);
        const settings = await platformSettingService.getBrandSettings();

        ResponseHandler.success(res, {
            message: 'Platform logo uploaded successfully',
            data: settings,
        });
    });

    getWebhookSettings = catchAsync(async (req, res) => {
        // Keep webhook list labels in English on admin UI for consistency.
        const settings = await platformSettingService.getWebhookSettings('en');

        ResponseHandler.success(res, {
            message: 'Webhook settings fetched successfully',
            data: settings,
        });
    });

    updateWebhookSettings = catchAsync(async (req, res) => {
        const payload = updateWebhookSettingsSchema.parse(req.body);
        await platformSettingService.updateWebhookSettings(payload, req.user.id);
        const settings = await platformSettingService.getWebhookSettings('en');

        ResponseHandler.success(res, {
            message: 'Webhook settings updated successfully',
            data: settings,
        });
    });

    testSms = catchAsync(async (req, res) => {
        const raw = req.body || {};
        const payload = testSmsSchema.parse({
            to: raw.to ?? raw.phone ?? raw.number ?? raw.destination,
            body: raw.body ?? raw.message,
        });
        const result = await platformSettingService.testSmsConnection(payload, req.locale);

        ResponseHandler.success(res, {
            message: result.message,
            data: result,
        });
    });
}

export const platformSettingController = new PlatformSettingController();
