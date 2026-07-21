
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { incomeController } from './Income.controller.js';
const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);
router.get('/my/summary', incomeController.getMyIncomeSummary);
router.get('/my', incomeController.getMyIncome);

const licenseUserGuard = authMiddleware.authorize('LICENSE_USER');
router.get('/dashboard/license-user', licenseUserGuard, incomeController.getLicenseUserDashboard);
router.get('/dashboard/license-user/report', licenseUserGuard, incomeController.getLicenseUserReport);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');
router.get('/summary', adminGuard, incomeController.getIncomeSummary);
router.get('/', adminGuard, incomeController.getIncomeDetails);
router.get('/license/:licenseId', adminGuard, incomeController.getIncomeByLicenseId);

const platformAdminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/platform/summary', platformAdminGuard, incomeController.getPlatformIncomeSummary);
router.get('/platform', platformAdminGuard, incomeController.getPlatformIncomeDetails);
router.get('/dashboard/platform-admin', platformAdminGuard, incomeController.getPlatformAdminDashboard);
router.get('/dashboard/platform-admin/report', platformAdminGuard, incomeController.getPlatformAdminReport);
export const IncomeRoutes = router;