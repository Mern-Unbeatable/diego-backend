import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { paymentService } from './payment.service.js';
import {
  createCourseCheckoutSchema,
  paymentQuerySchema,
  companyCourseCheckoutSchema,
  courseRenewalCheckoutSchema,
  companyCourseRenewalCheckoutSchema,
  verifyPaymentIntentSchema,
  verifyPayPalOrderSchema,
} from './payment.validation.js';

class PaymentController {
  constructor() {
    this.log = new Logger('PaymentController');
  }

  // ═══════════ SINGLE COURSE (existing) ═══════════

  createCourseCheckout = catchAsync(async (req, res) => {
    const { courseId, couponCode } = createCourseCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Course checkout: user=${userId} course=${courseId}`);

    const result = await paymentService.createCourseCheckout({ userId, courseId, couponCode });

    if (result.type === 'FREE') {
      return ResponseHandler.created(res, {
        message: result.message,
        data: { type: 'FREE', enrollment: result.enrollment },
      });
    }

    ResponseHandler.created(res, {
      message: 'Checkout session created',
      data: {
        type: 'PAID', url: result.url, sessionId: result.sessionId,
        originalPrice: result.originalPrice, finalPrice: result.finalPrice, discount: result.discount,
      },
    });
  });

  verifyAndEnroll = catchAsync(async (req, res) => {
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.user.id;
    if (!sessionId) throw new Error('session_id is required');

    const result = await paymentService.verifyAndEnroll(sessionId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Payment verified and enrollment created' : 'Payment not completed yet',
      data: result,
    });
  });

  createCoursePaymentIntent = catchAsync(async (req, res) => {
    const { courseId, couponCode } = createCourseCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Course payment intent: user=${userId} course=${courseId}`);

    const result = await paymentService.createCoursePaymentIntent({ userId, courseId, couponCode });

    if (result.type === 'FREE' || result.flow === 'FREE_ENROLLMENT') {
      return ResponseHandler.created(res, {
        message: result.message || 'Successfully enrolled in free course',
        data: result,
      });
    }

    ResponseHandler.created(res, {
      message: 'Payment intent created',
      data: result,
    });
  });

  verifyCoursePaymentIntent = catchAsync(async (req, res) => {
    const parsed = verifyPaymentIntentSchema.parse({
      payment_intent_id: req.query.payment_intent_id || req.body?.payment_intent_id,
      paymentIntentId: req.query.paymentIntentId || req.body?.paymentIntentId,
    });
    const paymentIntentId = parsed.payment_intent_id || parsed.paymentIntentId;
    const userId = req.user.id;

    const result = await paymentService.verifyCoursePaymentIntent(paymentIntentId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Payment verified and enrollment created' : 'Payment not completed yet',
      data: result,
    });
  });

  createCoursePayPalOrder = catchAsync(async (req, res) => {
    const { courseId, couponCode } = createCourseCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    const returnUrl = req.body?.returnUrl || null;
    const cancelUrl = req.body?.cancelUrl || null;

    const result = await paymentService.createCoursePayPalOrder({
      userId,
      courseId,
      couponCode,
      returnUrl,
      cancelUrl,
    });

    if (result.type === 'FREE' || result.flow === 'FREE_ENROLLMENT') {
      return ResponseHandler.created(res, {
        message: result.message || 'Successfully enrolled in free course',
        data: result,
      });
    }

    ResponseHandler.created(res, {
      message: 'PayPal order created',
      data: result,
    });
  });

  verifyCoursePayPalOrder = catchAsync(async (req, res) => {
    const parsed = verifyPayPalOrderSchema.parse({
      order_id: req.query.order_id || req.body?.order_id,
      orderId: req.query.orderId || req.body?.orderId,
    });
    const orderId = parsed.order_id || parsed.orderId;
    const userId = req.user.id;

    const result = await paymentService.verifyCoursePayPalOrder(orderId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'PayPal payment verified and enrollment created' : 'PayPal payment not completed yet',
      data: result,
    });
  });

  getMyPayments = catchAsync(async (req, res) => {
    const query = paymentQuerySchema.parse(req.query);
    const result = await paymentService.getMyPayments(req.user.id, query);
    ResponseHandler.success(res, { message: 'Payment history fetched', data: result });
  });

  getAllPayments = catchAsync(async (req, res) => {
    const query = paymentQuerySchema.parse(req.query);
    const result = await paymentService.getAllPayments(query, req.user);
    ResponseHandler.success(res, { message: 'All payments fetched', data: result });
  });

  handleWebhook = catchAsync(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) throw new Error('No stripe signature');
    const result = await paymentService.handleWebhook(req.body, signature);
    res.json(result);
  });

  createCompanyCourseCheckout = catchAsync(async (req, res) => {
    const { courseId, tierId, minUsers, maxUsers, seatsCount, couponCode } = companyCourseCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Company course checkout: user=${userId} course=${courseId} tierId=${tierId || 'legacy'}`);

    const result = await paymentService.createCompanyCourseCheckout({
      userId, courseId, tierId, minUsers, maxUsers, seatsCount, couponCode,
    });

    ResponseHandler.created(res, {
      message: 'Corporate checkout session created',
      data: {
        url: result.checkoutUrl, sessionId: result.sessionId,
        pricePerUser: result.pricePerUser, totalAmount: result.totalAmount,
        seatsCount: result.seatsCount, tierId: result.tierId,
        minUsers: result.minUsers, maxUsers: result.maxUsers,
      },
    });
  });

  createCompanyCoursePaymentIntent = catchAsync(async (req, res) => {
    const { courseId, tierId, minUsers, maxUsers, seatsCount, couponCode } = companyCourseCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Company course payment intent: user=${userId} course=${courseId} tierId=${tierId || 'legacy'}`);

    const result = await paymentService.createCompanyCoursePaymentIntent({
      userId, courseId, tierId, minUsers, maxUsers, seatsCount, couponCode,
    });

    ResponseHandler.created(res, {
      message: 'Corporate payment intent created',
      data: result,
    });
  });

  verifyCompanyCoursePaymentIntent = catchAsync(async (req, res) => {
    const parsed = verifyPaymentIntentSchema.parse({
      payment_intent_id: req.query.payment_intent_id || req.body?.payment_intent_id,
      paymentIntentId: req.query.paymentIntentId || req.body?.paymentIntentId,
    });
    const paymentIntentId = parsed.payment_intent_id || parsed.paymentIntentId;
    const userId = req.user.id;

    const result = await paymentService.verifyCompanyCoursePaymentIntent(paymentIntentId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Corporate payment verified' : 'Payment not completed yet',
      data: result,
    });
  });

  createCompanyCourseRenewalCheckout = catchAsync(async (req, res) => {
    const { companyCoursePurchaseId, tierId, minUsers, maxUsers, newSeatsCount, couponCode } = companyCourseRenewalCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Company renewal checkout: user=${userId} purchase=${companyCoursePurchaseId} tierId=${tierId || 'legacy'}`);

    const result = await paymentService.createCompanyCourseRenewalCheckout({
      userId, companyCoursePurchaseId, tierId, minUsers, maxUsers, newSeatsCount, couponCode,
    });

    ResponseHandler.created(res, {
      message: 'Corporate renewal checkout session created',
      data: {
        url: result.checkoutUrl, sessionId: result.sessionId,
        pricePerUser: result.pricePerUser, totalAmount: result.totalAmount, seatsCount: result.seatsCount,
      },
    });
  });

  verifyCompanyCoursePurchase = catchAsync(async (req, res) => {
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.user.id;
    if (!sessionId) throw new Error('session_id is required');

    const result = await paymentService.verifyCompanyCoursePurchase(sessionId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Corporate access purchased successfully' : 'Payment not completed yet',
      data: result,
    });
  });

  // ═══════════ SINGLE USER RENEWAL ═══════════

  createCourseRenewalCheckout = catchAsync(async (req, res) => {
    const { enrollmentId, couponCode } = courseRenewalCheckoutSchema.parse(req.body);
    const userId = req.user.id;
    this.log.info(`Course renewal checkout: user=${userId} enrollment=${enrollmentId}`);

    const result = await paymentService.createCourseRenewalCheckout({ userId, enrollmentId, couponCode });

    ResponseHandler.created(res, {
      message: 'Renewal checkout session created',
      data: { url: result.checkoutUrl, sessionId: result.sessionId, originalPrice: result.originalPrice, finalPrice: result.finalPrice },
    });
  });

  verifyCourseRenewal = catchAsync(async (req, res) => {
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.user.id;
    if (!sessionId) throw new Error('session_id is required');

    const result = await paymentService.verifyCourseRenewalPayment(sessionId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Course renewed successfully' : 'Payment not completed yet',
      data: result,
    });
  });

  // ═══════════ COMPANY CORPORATE PURCHASE RENEWAL ═══════════


  verifyCompanyCourseRenewal = catchAsync(async (req, res) => {
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.user.id;
    if (!sessionId) throw new Error('session_id is required');

    const result = await paymentService.verifyCompanyCourseRenewalPayment(sessionId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Corporate access renewed successfully' : 'Payment not completed yet',
      data: result,
    });
  });

  createArchiveCheckout = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const tenantId = req.tenantId || req.user.tenantId || null;
    this.log.info(`Archive checkout: user=${userId}`);

    const result = await paymentService.createArchiveCheckout({ userId, tenantId });

    ResponseHandler.created(res, {
      message: 'Archive storage checkout created',
      data: result,
    });
  });

  verifyArchivePayment = catchAsync(async (req, res) => {
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.user.id;
    if (!sessionId) throw new Error('session_id is required');

    const result = await paymentService.verifyArchivePayment(sessionId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Archive storage activated' : 'Payment not completed yet',
      data: result,
    });
  });

  createArchivePaymentIntent = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const tenantId = req.tenantId || req.user.tenantId || null;
    this.log.info(`Archive payment intent: user=${userId}`);

    const result = await paymentService.createArchivePaymentIntent({ userId, tenantId });

    ResponseHandler.created(res, {
      message: 'Archive payment intent created',
      data: result,
    });
  });

  verifyArchivePaymentIntent = catchAsync(async (req, res) => {
    const parsed = verifyPaymentIntentSchema.parse({
      payment_intent_id: req.query.payment_intent_id || req.body?.payment_intent_id,
      paymentIntentId: req.query.paymentIntentId || req.body?.paymentIntentId,
    });
    const paymentIntentId = parsed.payment_intent_id || parsed.paymentIntentId;
    const userId = req.user.id;

    const result = await paymentService.verifyArchivePaymentIntent(paymentIntentId, userId);

    ResponseHandler.success(res, {
      message: result.paid ? 'Archive storage activated' : 'Payment not completed yet',
      data: result,
    });
  });
}

export const paymentController = new PaymentController();