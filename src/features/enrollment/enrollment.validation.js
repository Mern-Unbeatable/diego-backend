import { z } from 'zod';

// ─────────────────────────────────────────────
// ENROLLMENT VALIDATION SCHEMAS
// ─────────────────────────────────────────────

export const createEnrollmentSchema = z.object({
    courseId: z.string().uuid('Invalid course ID format'),
    userId: z.string().uuid('Invalid user ID format').optional(),
    packagePurchaseId: z.string().uuid('Invalid package purchase ID').optional(),
    companyContextId: z.string().uuid('Invalid company context ID').optional(),
    expiresAt: z.coerce.date().optional(),
    assignedEmail: z.string().email('Invalid email format').optional(),
});

export const createSelfEnrollmentSchema = z.object({
    courseId: z.string().uuid('Invalid course ID format'),
});

export const updateEnrollmentSchema = z.object({
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'SUSPENDED']).optional(),
    startedAt: z.coerce.date().optional(),
    completedAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    accessLink: z.string().url('Invalid URL').optional(),
    accessLinkToken: z.string().optional(),
    accessLinkExpiresAt: z.coerce.date().optional(),
    accessLinkUsed: z.boolean().optional(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);

export const enrollmentQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'SUSPENDED']).optional(),
    courseId: z.string().uuid('Invalid course ID').optional(),
    userId: z.string().uuid('Invalid user ID').optional(),
    companyContextId: z.string().uuid('Invalid company context ID').optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['createdAt', 'startedAt', 'completedAt', 'expiresAt']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const generateAccessLinkSchema = z.object({
    enrollmentId: z.string().uuid('Invalid enrollment ID'),
    expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const accessLinkSchema = z.object({
    token: z.string().min(1, 'Access token is required'),
});

export const bulkEnrollSchema = z.object({
    userIds: z.array(z.string().uuid('Invalid user ID format')).min(1, 'At least one user ID is required'),
    courseId: z.string().uuid('Invalid course ID format'),
    expiresAt: z.coerce.date().optional(),
});

export const antiCheatLogSchema = z.object({
    lessonId: z.string().uuid('Invalid lesson ID').optional(),
    eventType: z.enum(['MOUSE_IDLE', 'TAB_CHANGE', 'WINDOW_BLUR', 'FULLSCREEN_EXIT']),
    metadata: z.record(z.any()).optional(),
});

export const redeemAccessLinkSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    birthDate: z.coerce.date(),
    birthPlace: z.string().optional(),
    taxCode: z.string().min(1, 'Tax code is required'),
    address: z.string().min(1, 'Address is required'),
    email: z.string().email().optional(),
    companyName: z.string().optional(),
    companyAddress: z.string().optional(),
    companyTaxId: z.string().optional(),
    companyVatNumber: z.string().optional(),
});