
import { z } from 'zod';
export const assignCourseSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    courseId: z.string().uuid('Invalid course ID'),
    companyId: z.string().uuid('Invalid company ID').optional(),
    dueDate: z.coerce.date().optional(),
});


export const bulkAssignCourseSchema = z.object({
    userIds: z.array(z.string().uuid('Invalid user ID')).min(1, 'At least one user is required'),
    courseId: z.string().uuid('Invalid course ID'),
    companyId: z.string().uuid('Invalid company ID').optional(),
    dueDate: z.coerce.date().optional(),
});

export const updateAssignCourseSchema = z.object({
    dueDate: z.coerce.date().optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);
export const assignCourseQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    assignedById: z.string().uuid().optional(),
    sortBy: z.enum(['createdAt', 'dueDate']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});