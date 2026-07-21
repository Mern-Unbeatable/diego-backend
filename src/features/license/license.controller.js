import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { licenseService } from './license.service.js';
import { paymentService } from '../payment/payment.service.js';
import {
    createLicenseSchema,
    updateLicenseSchema,
    renewLicenseSchema,
    licenseQuerySchema,
    toggleSuspensionSchema,
    createLicenseCheckoutSchema,
    createLicenseRenewalCheckoutSchema,
} from './license.validation.js';

class LicenseController {
    constructor() {
        this.log = new Logger('LicenseController');
    }

    // ── Public/User endpoints

    getPlans = catchAsync(async (req, res) => {
        const plans = await licenseService.getPlans(req.locale ?? 'it');
        ResponseHandler.success(res, { message: 'Plans fetched', data: { plans } });
    });

    getMyLicense = catchAsync(async (req, res) => {
        if (req.user.level !== 'LICENSEE') {
            throw new Error('Only LICENSEE users can view their license.');
        }
        const license = await licenseService.getLicenseByUser(req.user.id, req.user);
        if (!license) throw new Error('License not found.');
        ResponseHandler.success(res, { message: 'License fetched', data: { license } });
    });

    updateMyLicense = catchAsync(async (req, res) => {
        const payload = updateLicenseSchema.parse(req.body);
        const license = await licenseService.updateLicense(req.user.id, payload, req.user);
        this.log.info(`License updated — userId: ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'License updated', data: { license } });
    });

    getMyLicenseStats = catchAsync(async (req, res) => {
        const stats = await licenseService.getLicenseStats(req.user.id, req.user);
        ResponseHandler.success(res, { message: 'Stats fetched', data: { stats } });
    });


    createLicenseCheckout = catchAsync(async (req, res) => {
        const payload = createLicenseCheckoutSchema.parse(req.body);
        const result = await licenseService.createLicenseCheckout(payload, req.user);

        ResponseHandler.created(res, {
            message: 'Checkout session created',
            data: result,
        });
    });

    createRenewalCheckout = catchAsync(async (req, res) => {
        const payload = createLicenseRenewalCheckoutSchema.parse(req.body);
        const result = await licenseService.createRenewalCheckout(payload, req.user);

        ResponseHandler.created(res, {
            message: 'Renewal checkout session created',
            data: result,
        });
    });

    verifyLicensePayment = catchAsync(async (req, res) => {
        const { session_id } = req.query;
        if (!session_id) throw new Error('session_id is required');

        const result = await paymentService.verifyLicensePayment(session_id, req.user.id);

        ResponseHandler.success(res, {
            message: result.paid ? 'Payment verified successfully' : 'Payment not completed',
            data: result,
        });
    });

    // ── Admin endpoints ──────────────────────────────────────────────────────

    createLicense = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Administrators can create licenses.');
        }

        const payload = createLicenseSchema.parse(req.body);
        const result = await licenseService.createLicense(payload, req.user);

        this.log.info(`License created — company: ${payload.companyName} by admin: ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'License created successfully',
            data: result
        });
    });

    getLicenseByUser = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view other licenses.');
        }
        const license = await licenseService.getLicenseByUser(req.params.userId, req.user);
        if (!license) throw new Error('License not found.');
        ResponseHandler.success(res, { message: 'License fetched', data: { license } });
    });

    getAllLicenses = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can list all licenses.');
        }
        const query = licenseQuerySchema.parse(req.query);
        const result = await licenseService.getAllLicenses(query, req.user);
        ResponseHandler.success(res, { message: 'Licenses fetched', data: result });
    });

    updateLicense = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can update other licenses.');
        }
        const payload = updateLicenseSchema.parse(req.body);
        const license = await licenseService.updateLicense(req.params.userId, payload, req.user);
        this.log.info(`License updated — userId: ${req.params.userId} by: ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'License updated', data: { license } });
    });

    renewLicense = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can renew other licenses.');
        }
        const data = renewLicenseSchema.parse(req.body);
        const result = await licenseService.renewLicense(req.params.userId, data, req.user);
        this.log.info(`License renewed — userId: ${req.params.userId}`);
        ResponseHandler.updated(res, { message: 'License renewed', data: result });
    });

    toggleLicenseSuspension = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can suspend licenses.');
        }
        const { userId } = req.params;
        const { isSuspended } = toggleSuspensionSchema.parse(req.body);
        const license = await licenseService.toggleLicenseSuspension(userId, isSuspended, req.user);
        this.log.info(`License ${isSuspended ? 'suspended' : 'unsuspended'} — userId: ${userId}`);
        ResponseHandler.updated(res, {
            message: `License ${isSuspended ? 'suspended' : 'unsuspended'}`,
            data: { license },
        });
    });

    getLicenseStats = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view other license stats.');
        }
        const userId = req.params.userId;
        const stats = await licenseService.getLicenseStats(userId, req.user);
        ResponseHandler.success(res, { message: 'Stats fetched', data: { stats } });
    });

    deleteLicense = catchAsync(async (req, res) => {
        if (req.user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Administrators can delete licenses.');
        }
        const result = await licenseService.deleteLicense(req.params.userId, req.user);
        this.log.info(`License deleted — userId: ${req.params.userId}`);
        ResponseHandler.success(res, { message: result.message, data: result });
    });

    getMyLicenses = catchAsync(async (req, res) => {
        if (req.user.level !== 'LICENSE_USER') {
            throw new Error('Only LICENSEE users can view their licenses.');
        }
        // statusFilter query param: 'ACTIVE' | 'EXPIRING' | 'EXPIRED'
        const { statusFilter } = req.query;
        const result = await licenseService.getMyLicenses(req.user.id, { statusFilter }, req.user);

        ResponseHandler.success(res, {
            message: 'License fetched',
            data: result,
        });
    });

    renewMyLicense = catchAsync(async (req, res) => {
        const data = renewLicenseSchema.parse(req.body);
        const result = await licenseService.renewLicense(req.user.id, data, req.user);
        this.log.info(`License renewed — userId: ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'License renewed', data: result });
    });
}

export const licenseController = new LicenseController();