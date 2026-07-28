import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { companyCoursePurchaseService } from './companyCoursePricing.service.js';
import { assignSeatSchema, bulkAssignSeatsSchema, inviteEmployeeSchema } from './comapnyCoursePrising.validation.js';

class CompanyCoursePurchaseController {
    constructor() {
        this.log = new Logger('CompanyCoursePurchaseController');
    }

    getMyPurchases = catchAsync(async (req, res) => {
        if (!req.user.companyId) throw new Error('This account is not linked to a company');
        const result = await companyCoursePurchaseService.getCompanyPurchases(req.user.companyId);
        ResponseHandler.success(res, { message: 'Corporate purchases fetched', data: { purchases: result } });
    });

    getPurchaseById = catchAsync(async (req, res) => {
        const result = await companyCoursePurchaseService.getPurchaseById(req.params.id, req.user.id);
        ResponseHandler.success(res, { message: 'Purchase fetched', data: { purchase: result } });
    });

    assignSeat = catchAsync(async (req, res) => {
        const payload = assignSeatSchema.parse(req.body);
        const result = await companyCoursePurchaseService.assignSeat(payload, req.user.id);
        this.log.info(`Seat assigned: employee=${payload.employeeUserId} by ${req.user.id}`);
        ResponseHandler.created(res, { message: 'Employee assigned successfully', data: result });
    });

    bulkAssignSeats = catchAsync(async (req, res) => {
        const payload = bulkAssignSeatsSchema.parse(req.body);
        const result = await companyCoursePurchaseService.bulkAssignSeats(payload, req.user.id);
        ResponseHandler.created(res, { message: 'Bulk assignment completed', data: result });
    });

    inviteAndAssignEmployee = catchAsync(async (req, res) => {
        const payload = inviteEmployeeSchema.parse(req.body);
        const result = await companyCoursePurchaseService.inviteAndAssignEmployee(payload, req.user.id);
        this.log.info(`Employee invited & assigned: ${payload.email} by ${req.user.id}`);
        ResponseHandler.created(res, { message: 'Employee invited and assigned successfully', data: result });
    });

    revokeSeat = catchAsync(async (req, res) => {
        const { enrollmentId } = req.params;
        const result = await companyCoursePurchaseService.revokeSeat(enrollmentId, req.user.id);
        ResponseHandler.success(res, { message: 'Seat revoked successfully', data: result });
    });
}

export const companyCoursePurchaseController = new CompanyCoursePurchaseController();