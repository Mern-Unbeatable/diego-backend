import { z } from 'zod';

const resolveCourseIds = (data) => {
    const courseIds = data.courseIds?.length
        ? data.courseIds
        : (data.courseId ? [data.courseId] : []);

    const { courseId: _courseId, ...rest } = data;
    return { ...rest, courseIds };
};

const resolveRole = (data) => ({
    ...data,
    jobTitle: data.jobTitle ?? data.role,
    role: data.role ?? data.jobTitle,
});

const courseAssignmentRefine = (schema) => schema.refine(
    (d) => !d.companyCoursePurchaseId || !d.courseIds?.length || d.courseIds.length <= 1,
    {
        message: 'When companyCoursePurchaseId is provided, only one course is allowed',
        path: ['courseIds'],
    },
);

const courseAssignmentFields = {
    courseId: z.string().uuid().optional(),
    courseIds: z.array(z.string().uuid()).optional(),
    companyCoursePurchaseId: z.string().uuid('Invalid company purchase ID').optional(),
};

/** UI: Name, Surname, Email, Contact, Role, Date of employment — all required on add */
export const addEmployeeSchema = courseAssignmentRefine(
    z.object({
        firstName: z.string().min(2).max(50),
        lastName: z.string().min(2).max(50),
        email: z.string().email('Invalid email'),
        contactNumber: z.string().min(6).max(32),
        jobTitle: z.string().min(2).max(100).optional(),
        role: z.string().min(2).max(100).optional(),
        employmentDate: z.coerce.date({ required_error: 'Date of employment is required' }),
        birthDate: z.coerce.date().optional(),
        city: z.string().min(2).max(100).optional(),
        traineeTaxCode: z.string().min(11).max(32).optional(),
        password: z.string().min(6).max(50).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
        ...courseAssignmentFields,
    })
        .refine((d) => Boolean(d.jobTitle || d.role), {
            message: 'Role is required',
            path: ['role'],
        })
        .transform((data) => resolveCourseIds(resolveRole(data))),
);

/** UI edit form — all fields optional except at least one must be sent */
export const updateEmployeeSchema = courseAssignmentRefine(
    z.object({
        firstName: z.string().min(2).max(50).optional(),
        lastName: z.string().min(2).max(50).optional(),
        contactNumber: z.string().min(6).max(32).optional(),
        jobTitle: z.string().min(2).max(100).optional(),
        role: z.string().min(2).max(100).optional(),
        employmentDate: z.coerce.date().optional(),
        birthDate: z.coerce.date().optional(),
        city: z.string().min(2).max(100).optional(),
        traineeTaxCode: z.string().min(11).max(32).optional(),
        password: z.string().min(6).max(50).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
        isActive: z.boolean().optional(),
        ...courseAssignmentFields,
    })
        .refine(
            (d) => Object.keys(d).some((k) => d[k] !== undefined),
            { message: 'At least one field is required' },
        )
        .transform((data) => {
            const hasCourseInput = Boolean(data.courseId || data.courseIds?.length);
            const resolved = resolveCourseIds(resolveRole(data));
            return {
                ...resolved,
                courseIds: hasCourseInput ? resolved.courseIds : undefined,
            };
        }),
);

export const employeeQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
    sortBy: z.enum(['createdAt', 'firstName', 'lastName', 'employmentDate']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const assignCoursesToEmployeeSchema = courseAssignmentRefine(
    z.object({
        ...courseAssignmentFields,
    })
        .refine(
            (d) => Boolean(d.courseId || d.courseIds?.length || d.companyCoursePurchaseId),
            { message: 'At least one course assignment field is required (courseId, courseIds, or companyCoursePurchaseId)' },
        )
        .transform((data) => resolveCourseIds(data)),
);

export const employeeEnrollmentQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'SUSPENDED']).optional(),
    courseId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
    employeeName: z.string().max(100).optional(),
    courseName: z.string().max(100).optional(),
    sortBy: z.enum(['createdAt', 'startedAt', 'completedAt', 'expiresAt', 'updatedAt']).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const employeeCertificateQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    courseId: z.string().uuid().optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    status: z.enum(['PENDING', 'ISSUED', 'ARCHIVED', 'REVOKED']).optional(),
    search: z.string().max(100).optional(),
    employeeName: z.string().max(100).optional(),
    courseName: z.string().max(100).optional(),
});
