
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { incomeService } from './Income.service.js';
import {
    licenseIncomeQuerySchema,
    settleIncomeSchema,
    platformIncomeQuerySchema,
} from './Income.validation.js';

class IncomeController {
    constructor() {
        this.log = new Logger('IncomeController');
    }


    getIncomeSummary = catchAsync(async (req, res) => {
        const { licenseId } = req.query;

        const summary = await incomeService.getIncomeSummary(
            licenseId,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Income summary fetched successfully',
            data: summary
        });
    });

    getIncomeDetails = catchAsync(async (req, res) => {
        const query = licenseIncomeQuerySchema.parse(req.query);

        const result = await incomeService.getIncomeDetails(
            query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Income details fetched successfully',
            data: result
        });
    });


    getIncomeByLicenseId = catchAsync(async (req, res) => {
        const { licenseId } = req.params;
        const query = licenseIncomeQuerySchema.parse(req.query);

        const result = await incomeService.getIncomeByLicenseId(
            licenseId,
            query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'License income fetched successfully',
            data: result
        });
    });

    getMyIncome = catchAsync(async (req, res) => {
        const query = licenseIncomeQuerySchema.parse(req.query);

        const result = await incomeService.getMyIncome(
            query,
            req.user.id
        );

        ResponseHandler.success(res, {
            message: 'My income fetched successfully',
            data: result
        });
    });

    getMyIncomeSummary = catchAsync(async (req, res) => {
        const summary = await incomeService.getMyIncomeSummary(
            req.user.id
        );

        ResponseHandler.success(res, {
            message: 'My income summary fetched successfully',
            data: summary
        });
    });

    getPlatformIncomeSummary = catchAsync(async (req, res) => {
        const query = platformIncomeQuerySchema.parse(req.query);

        const result = await incomeService.getPlatformIncomeSummary(
            query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Platform income summary fetched successfully',
            data: result
        });
    });

    getPlatformIncomeDetails = catchAsync(async (req, res) => {
        const query = platformIncomeQuerySchema.parse(req.query);

        const result = await incomeService.getPlatformIncomeDetails(
            query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Platform income details fetched successfully',
            data: result
        });
    });



}

export const incomeController = new IncomeController();
export { IncomeController };