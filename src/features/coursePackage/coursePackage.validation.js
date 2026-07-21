import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

const i18nString = (required = true) => {
    const base = z
        .object(SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: z.string().min(1).optional() }), {}))
        .refine(obj => Object.keys(obj).length > 0, { message: 'At least one locale translation is required' });
    return required ? base : base.optional();
};

// ✅ FIX: `type` field আবার যোগ করা হলো — refine এ এটাই চেক হচ্ছিল কিন্তু schema তে ছিল না
const featureItemSchema = z.object({
    id: z.string().uuid().optional(),
    type: z.enum(['pricing', 'feature']).default('feature'),
    label: i18nString(true),
    price: z.coerce.number().min(0).optional(),
    currency: z.string().default('EUR').optional(),
    minUsers: z.coerce.number().int().min(1).optional(),
    maxUsers: z.coerce.number().int().min(1).optional().nullable(),
}).refine(
    d => d.type !== 'pricing' || (d.minUsers !== undefined && d.price !== undefined),
    { message: 'minUsers and price are required for pricing-type features', path: ['minUsers'] }
).refine(
    d => d.maxUsers == null || d.maxUsers >= (d.minUsers || 0),
    { message: 'maxUsers must be >= minUsers', path: ['maxUsers'] }
);

// SINGLE_USER packages এর features হলো plain i18n string (কোনো pricing না)
const simpleFeatureSchema = z.object(
    SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: z.string().min(1).optional() }), {})
);

export const createCoursePackageSchema = z.object({
    type: z.enum(['SINGLE_USER', 'COMPANY'], { required_error: 'type is required' }),
    key: z.string().max(100).optional(),
    title: i18nString(true),
    description: i18nString(false),
    features: z.array(z.union([featureItemSchema, simpleFeatureSchema])).optional(),
    isActive: z.coerce.boolean().default(true),
    isDefault: z.coerce.boolean().default(false),
    tenantId: z.string().uuid().optional(),
});

export const updateCoursePackageSchema = createCoursePackageSchema
    .partial()
    .refine(d => Object.keys(d).length > 0, { message: 'At least one field must be provided for update' });

export const coursePackageQuerySchema = z.object({
    type: z.enum(['SINGLE_USER', 'COMPANY']).optional(),
    isActive: z.string().transform(v => v === 'true').optional(),
    tenantId: z.string().uuid().optional(),
});