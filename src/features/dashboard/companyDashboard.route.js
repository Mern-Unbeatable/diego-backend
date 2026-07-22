import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { companyDashboardController } from './companyDashboard.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const companyAdminGuard = authMiddleware.authorize('COMPANY_ADMIN');

router.get('/company-admin', companyAdminGuard, companyDashboardController.getDashboard);

export const companyDashboardRoutes = router;
