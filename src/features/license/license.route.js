import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { licenseController } from './license.controller.js';

const router = express.Router();

router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// Public (no auth needed for plan listing)
router.get('/plans', licenseController.getPlans);

// ── Licensee self-service routes ──────────────────────────────────────────

router.get('/my', licenseController.getMyLicenses);
router.get('/my/detail', licenseController.getMyLicense);
router.patch('/my', licenseController.updateMyLicense);
router.post('/my/renew', licenseController.renewMyLicense);
router.get('/my/stats', licenseController.getMyLicenseStats);

// ── Checkout / payment ────────────────────────────────────────────────────
router.post('/checkout', licenseController.createLicenseCheckout);
router.post('/renewal/checkout', licenseController.createRenewalCheckout);
router.get('/verify-payment', licenseController.verifyLicensePayment);

// ── Admin only ────────────────────────────────────────────────────────────
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