import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { platformSettingService } from './platformSetting.service.js';
import { updateEmergencyControlsSchema } from './platformSetting.validation.js';

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
}

export const platformSettingController = new PlatformSettingController();
