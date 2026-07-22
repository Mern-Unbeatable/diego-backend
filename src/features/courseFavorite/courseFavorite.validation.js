import { z } from 'zod';

export const courseIdParamSchema = z.object({
    courseId: z.string().uuid('Invalid course ID'),
});

export const favoriteCourseQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    category: z.enum(['SEVESO', 'MANDATORY', 'CATALOG']).optional(),
    format: z.string().max(50).optional(),
    sortBy: z.enum(['createdAt', 'favoritedAt', 'price', 'courseTitle']).default('favoritedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
