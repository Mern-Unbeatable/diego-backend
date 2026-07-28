import { z } from 'zod';

const PLAN_TIERS = ['BEGINNER', 'STANDARD', 'PREMIUM', 'ENTERPRISE'];
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];

const subdomainSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Subdomain must be lowercase alphanumeric with hyphens')
    .optional();

const customDomainSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/,
        'Invalid domain format',
    )
    .optional();


export const createLicenseSchema = z
    .object({
        userId: z.string().uuid('Invalid user ID').optional(),
        email: z.string().email('Invalid email').optional(),
        firstName: z.string().min(2).max(50).optional(),
        lastName: z.string().min(2).max(50).optional(),
        password: z.string().min(8).optional(),
        companyName: z.string().min(2, 'Company name is required').max(120),
        phoneNumber: z.string().min(6).max(20).optional().nullable(),
        emailAddress: z.string().email().optional().nullable(),
        certifiedEmail: z.string().email('Invalid PEC email').optional().nullable(),
        subdomain: subdomainSchema.unwrap(),
        customDomain: customDomainSchema.unwrap(),
        planTier: z.enum(PLAN_TIERS, { required_error: 'Plan tier is required' }),
        vatNumber: z.string().min(8).max(32).optional().nullable(),
        vatPercentage: z.number().min(0).max(100).default(22).optional(),
        durationDays: z.number().int().min(30).max(730).default(365).optional(),
        autoRenew: z.boolean().default(false).optional(),
        billingCycle: z.enum(BILLING_CYCLES).default('YEARLY').optional(),
        couponCode: z.string().optional(),
    })
    .refine(d => d.userId || d.email, {
        message: 'Either userId or email must be provided.',
        path: ['userId'],
    });

// ── Update License Schema ──
export const updateLicenseSchema = z
    .object({
        companyName: z.string().min(2).max(120).optional(),
        phoneNumber: z.string().min(6).max(20).optional(),
        emailAddress: z.string().email().optional(),
        certifiedEmail: z.string().email().optional(),
        subdomain: subdomainSchema,
        customDomain: customDomainSchema,
        planTier: z.enum(PLAN_TIERS).optional(),
        vatNumber: z.string().min(8).max(32).optional(),
        vatPercentage: z.number().min(0).max(100).optional(),
        autoRenew: z.boolean().optional(),
        maxUsers: z.number().int().min(1).optional(),
        maxCourses: z.number().int().min(1).optional(),
        storageMb: z.number().int().min(100).optional(),
        billingCycle: z.enum(BILLING_CYCLES).optional(),
    })
    .refine(d => Object.keys(d).length > 0, { message: 'At least one field must be provided.' });




export const licenseQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    isSuspended: z.string().transform(v => v === 'true').optional(),
    tenantId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    planTier: z.enum(PLAN_TIERS).optional(),
    sortBy: z.enum(['createdAt', 'expiresAt', 'companyName']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const toggleSuspensionSchema = z.object({
    isSuspended: z.boolean({ required_error: 'isSuspended is required' }),
});

export const createLicenseCheckoutSchema = z.object({
    planId: z.string().uuid('Invalid plan ID'),
    billingCycle: z.enum(BILLING_CYCLES).default('YEARLY'),
    couponCode: z.string().optional(),
    companyName: z.string().min(2, 'Company name is required').max(120),
    subdomain: subdomainSchema.unwrap(),
    customDomain: customDomainSchema.unwrap(),
    phoneNumber: z.string().optional(),
    emailAddress: z.string().email().optional(),
    certifiedEmail: z.string().email().optional(),
    vatNumber: z.string().optional(),
    vatPercentage: z.number().min(0).max(100).optional(),
});


export const createLicenseRenewalCheckoutSchema = z.object({
    licenseId: z.string().uuid('Invalid license ID'),
    planId: z.string().uuid('Optional - plan to upgrade to').optional(),
    billingCycle: z.enum(BILLING_CYCLES).default('YEARLY'),
    couponCode: z.string().optional(),
});

// Add license status filter query schema
export const licenseStatusQuerySchema = z.object({
    statusFilter: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED']).optional(),
});

// Updated renew schema — paymentId optional (used internally after checkout)
export const renewLicenseSchema = z.object({
    daysToAdd: z.number().int().min(30).max(730).default(365),
    planTier: z.enum(PLAN_TIERS).optional(),
    billingCycle: z.enum(BILLING_CYCLES).default('YEARLY').optional(),
    couponCode: z.string().optional(),
    paymentId: z.string().uuid().optional(),
});