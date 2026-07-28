
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { licensePlanService } from './licensePlan.service.js';
import {
    createLicensePlanSchema,
    updateLicensePlanSchema
} from './licensePlan.validation.js';

class LicensePlanController {
    constructor() {
        this.log = new Logger('LicensePlanController');
    }
    getAllLicensePlans = catchAsync(async (req, res) => {

        const result = await licensePlanService.getAllLicensePlans(
            req.query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'License plans fetched successfully',
            data: result
        });
    });

    createLicensePlan = catchAsync(async (req, res) => {
        const payload = createLicensePlanSchema.parse(req.body);

        const plan = await licensePlanService.createLicensePlan(
            payload,
            req.user.id
        );

        this.log.info(`License plan created: ${plan.id} (${plan.tier}) by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'License plan created successfully',
            data: { plan }
        });
    });

    updateLicensePlan = catchAsync(async (req, res) => {
        const payload = updateLicensePlanSchema.parse(req.body);

        const plan = await licensePlanService.updateLicensePlan(
            req.params.id,
            payload,
            req.user.id
        );

        this.log.info(`License plan updated: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'License plan updated successfully',
            data: { plan }
        });
    });

    deleteLicensePlan = catchAsync(async (req, res) => {
        const deleted = await licensePlanService.deleteLicensePlan(
            req.params.id,
            req.user.id
        );

        this.log.info(`License plan deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'License plan deleted successfully',
            data: {
                planId: deleted.id,
                tier: deleted.tier,
                deletedAt: new Date().toISOString()
            }
        });
    });

    toggleActive = catchAsync(async (req, res) => {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            throw new Error('isActive (boolean) is required');
        }

        const result = await licensePlanService.toggleActive(
            req.params.id,
            isActive,
            req.user.id
        );

        ResponseHandler.updated(res, {
            message: `License plan ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: { plan: result }
        });
    });
}

export const licensePlanController = new LicensePlanController();
export { LicensePlanController };