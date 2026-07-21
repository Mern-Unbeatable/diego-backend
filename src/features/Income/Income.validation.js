import { z } from 'zod';
export const licenseIncomeQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    licenseId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    settled: z.string().transform(v => v === 'true').optional(),
    sortBy: z.enum(['createdAt', 'grossAmount', 'licenseeAmount']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export const settleIncomeSchema = z.object({
    incomeIds: z.array(z.string().uuid('Invalid income ID')).min(1, 'At least one income ID is required'),
});

export const platformIncomeQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    tenantId: z.string().uuid().optional(),
    type: z.enum(['SINGLE_COURSE', 'PACKAGE', 'LICENSE', 'ARCHIVE_STORAGE', 'COUPON']).optional(),
    sortBy: z.enum(['createdAt', 'amount']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const dashboardQuerySchema = z.object({
    periodDays: z.coerce.number().int().min(1).max(365).default(30),
    chartDays: z.coerce.number().int().min(1).max(90).default(7),
    locale: z.enum(['it', 'en', 'fr', 'zh']).optional(),
});