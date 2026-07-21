import { z } from 'zod';

export const addEmployeeSchema = z.object({
    firstName: z.string().min(2).max(50),
    lastName: z.string().min(2).max(50),
    email: z.string().email('Invalid email'),
    contactNumber: z.string().min(6).max(32).optional(),
    birthDate: z.coerce.date().optional(),
    city: z.string().min(2).max(100).optional(),
    traineeTaxCode: z.string().min(11).max(32).optional(),
    jobTitle: z.string().min(2).max(100).optional(),
    password: z.string().min(6).max(50).optional(),
    courseIds: z.array(z.string().uuid()).min(1, 'At least one course must be assigned').optional(),
    companyCoursePurchaseId: z.string().uuid('Invalid company purchase ID').optional(),
    expiresAt: z.coerce.date().optional(),
}).refine(
    d => !d.companyCoursePurchaseId || !d.courseIds || d.courseIds.length <= 1,
    {
        message: 'When companyCoursePurchaseId is provided, only one courseId is allowed',
        path: ['courseIds'],
    }
);

export const updateEmployeeSchema = z.object({
    firstName: z.string().min(2).max(50).optional(),
    lastName: z.string().min(2).max(50).optional(),
    jobTitle: z.string().min(2).max(100).optional(),
    contactNumber: z.string().min(6).max(32).optional(),
    birthDate: z.coerce.date().optional(),
    city: z.string().min(2).max(100).optional(),
    traineeTaxCode: z.string().min(11).max(32).optional(),
    isActive: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

export const employeeQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['createdAt', 'firstName', 'lastName']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});