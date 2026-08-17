import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { platformSettingController } from './platformSetting.controller.js';

const router = express.Router();

router.use(i18nMiddleware);

// Public — frontend can check maintenance / feature flags before login
router.get('/status', platformSettingController.getPublicStatus);

router.use(authMiddleware.protect);

const platformAdminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/emergency-controls', platformAdminGuard, platformSettingController.getEmergencyControls);
router.patch('/emergency-controls', platformAdminGuard, platformSettingController.updateEmergencyControls);
router.get('/certificate-archive-plan', platformAdminGuard, platformSettingController.getCertificateArchivePlan);
router.patch('/certificate-archive-plan', platformAdminGuard, platformSettingController.updateCertificateArchivePlan);
router.get('/financial', platformAdminGuard, platformSettingController.getFinancialSettings);
router.patch('/financial', platformAdminGuard, platformSettingController.updateFinancialSettings);

export const platformSettingRoutes = router;
