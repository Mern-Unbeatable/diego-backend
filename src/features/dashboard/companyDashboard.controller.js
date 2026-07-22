import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { companyDashboardService } from './companyDashboard.service.js';
import { companyDashboardQuerySchema } from './companyDashboard.validation.js';

class CompanyDashboardController {
    constructor() {
        this.log = new Logger('CompanyDashboardController');
    }

    getDashboard = catchAsync(async (req, res) => {
        const query = companyDashboardQuerySchema.parse(req.query);
        const result = await companyDashboardService.getDashboard(req.user, query);

        ResponseHandler.success(res, {
            message: 'Company admin dashboard fetched successfully',
            data: result,
        });
    });
}

export const companyDashboardController = new CompanyDashboardController();
