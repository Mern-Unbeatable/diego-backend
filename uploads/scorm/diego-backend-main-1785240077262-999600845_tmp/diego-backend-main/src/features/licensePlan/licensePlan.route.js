import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { licensePlanController } from './licensePlan.controller.js';

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);
router.get('/', licensePlanController.getAllLicensePlans);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.post('/', adminGuard, licensePlanController.createLicensePlan);
router.patch('/:id', adminGuard, licensePlanController.updateLicensePlan);
router.delete('/:id', adminGuard, licensePlanController.deleteLicensePlan);
router.patch('/:id/toggle-active', adminGuard, licensePlanController.toggleActive);

export const licensePlanRoutes = router;