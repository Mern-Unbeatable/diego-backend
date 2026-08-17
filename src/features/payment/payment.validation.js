import { z } from 'zod';

export const createCourseCheckoutSchema = z.object({
  courseId: z.string().uuid('Invalid course ID'),
  couponCode: z.string().optional(),
});

export const verifyPaymentSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});

export const verifyPaymentIntentSchema = z.object({
  payment_intent_id: z.string().min(1).optional(),
  paymentIntentId: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.payment_intent_id || data.paymentIntentId),
  { message: 'payment_intent_id is required' },
);

export const verifyPayPalOrderSchema = z.object({
  order_id: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.order_id || data.orderId),
  { message: 'orderId is required' },
);

export const paymentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']).optional(),
  type: z.enum(['SINGLE_COURSE', 'PACKAGE', 'LICENSE', 'ARCHIVE_STORAGE', 'COUPON']).optional(),
  tenantId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'amount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const companyCourseCheckoutSchema = z.object({
  courseId: z.string().uuid('Invalid course ID'),
  tierId: z.string().uuid().optional(),
  minUsers: z.coerce.number().int().min(1).optional(),
  maxUsers: z.coerce.number().int().min(1).optional().nullable(),
  seatsCount: z.coerce.number().int().min(1).optional(),
  couponCode: z.string().optional(),
}).refine(
  d => d.tierId || d.minUsers != null,
  { message: 'Either tierId or minUsers must be provided to identify the selected package', path: ['tierId'] }
);


export const courseRenewalCheckoutSchema = z.object({
  enrollmentId: z.string().uuid('Invalid enrollment ID'),
  couponCode: z.string().optional(),
});


export const companyCourseRenewalCheckoutSchema = z.object({
  companyCoursePurchaseId: z.string().uuid('Invalid purchase ID'),
  tierId: z.string().uuid().optional(),
  minUsers: z.coerce.number().int().min(1).optional(),
  maxUsers: z.coerce.number().int().min(1).optional().nullable(),
  newSeatsCount: z.coerce.number().int().min(1).optional(),
  couponCode: z.string().optional(),
});

export const pricingTierInputSchema = z.object({
  minUsers: z.coerce.number().int().min(1),
  maxUsers: z.coerce.number().int().min(1).optional().nullable(),
  price: z.coerce.number().min(0),
});