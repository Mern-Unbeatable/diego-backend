import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { paymentController } from './payment.controller.js';

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);

router.use(authMiddleware.protect);

// ── Single course ──
router.post('/checkout/course', paymentController.createCourseCheckout);
router.get('/verify', paymentController.verifyAndEnroll);
router.post('/intent/course', paymentController.createCoursePaymentIntent);
router.get('/intent/course/verify', paymentController.verifyCoursePaymentIntent);

// ── Company corporate course — first purchase ──
const companyGuard = authMiddleware.authorize('COMPANY_ADMIN', 'PLATFORM_ADMIN');
router.post('/checkout/company-course', companyGuard, paymentController.createCompanyCourseCheckout);
router.post('/intent/company-course', companyGuard, paymentController.createCompanyCoursePaymentIntent);
router.get('/intent/company-course/verify', companyGuard, paymentController.verifyCompanyCoursePaymentIntent);
router.get('/verify/company-course', companyGuard, paymentController.verifyCompanyCoursePurchase);

// ── Single user renewal ──
router.post('/renew/course', paymentController.createCourseRenewalCheckout);
router.get('/renew/course/verify', paymentController.verifyCourseRenewal);

// ── Company corporate purchase renewal ──
router.post('/renew/company-course', companyGuard, paymentController.createCompanyCourseRenewalCheckout);
router.get('/renew/company-course/verify', companyGuard, paymentController.verifyCompanyCourseRenewal);

router.get('/my', paymentController.getMyPayments);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');
router.get('/admin/all', adminGuard, paymentController.getAllPayments);

router.post('/checkout/archive', paymentController.createArchiveCheckout);
router.get('/verify/archive', paymentController.verifyArchivePayment);
router.post('/intent/archive', paymentController.createArchivePaymentIntent);
router.get('/intent/archive/verify', paymentController.verifyArchivePaymentIntent);

export const paymentRoutes = router;