import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { licenseController } from './license.controller.js';

const router = express.Router();

router.use(tenantMiddleware);

// Public — no login required
router.get('/plans', i18nMiddleware, licenseController.getPlans);

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const licenseUserGuard = authMiddleware.authorize('LICENSE_USER', 'PLATFORM_ADMIN');

// ── License user self-service ──
router.get('/my', licenseUserGuard, licenseController.getMyLicenses);
router.get('/my/detail', licenseUserGuard, licenseController.getMyLicense);
router.patch('/my', licenseUserGuard, licenseController.updateMyLicense);
router.get('/my/stats', licenseUserGuard, licenseController.getMyLicenseStats);

// ── Checkout / payment ──
router.post('/checkout', licenseUserGuard, licenseController.createLicenseCheckout);
router.post('/renewal/checkout', licenseUserGuard, licenseController.createRenewalCheckout);
router.get('/verify-payment', licenseController.verifyLicensePayment);

// ── Admin only ──
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');

router.post('/', adminGuard, licenseController.createLicense);
router.get('/', adminGuard, licenseController.getAllLicenses);
router.get('/:userId', adminGuard, licenseController.getLicenseByUser);
router.patch('/:userId', adminGuard, licenseController.updateLicense);
router.post('/:userId/renew', adminGuard, licenseController.renewLicense);
router.patch('/:userId/toggle-suspension', adminGuard, licenseController.toggleLicenseSuspension);
router.get('/:userId/stats', adminGuard, licenseController.getLicenseStats);
router.delete('/:userId', adminGuard, licenseController.deleteLicense);

export const licenseRoutes = router;
