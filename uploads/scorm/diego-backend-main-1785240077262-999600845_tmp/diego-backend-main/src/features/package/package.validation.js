
import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

const i18nString = (required = true) => {
    const base = z
        .record(z.string().min(1, 'Translation cannot be empty'))
        .refine(
            obj => {
                const keys = Object.keys(obj);
                if (keys.length === 0) return false;
                return keys.every(key => SUPPORTED_LOCALES.includes(key));
            },
            { message: 'At least one valid locale translation is required' }
        );
    return required ? base : base.optional();
};

export const createPackageSchema = z.object({
    name: i18nString(true),
    slug: z.string().min(2).max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')
        .optional(),
    description: i18nString(false),
    price: z.coerce.number().min(0, 'Price must be 0 or greater'),
    seatsCount: z.coerce.number().int().min(1, 'Seats count must be at least 1'),
    validityDays: z.coerce.number().int().min(1, 'Validity days must be at least 1').default(180),
    isActive: z.coerce.boolean().default(true),
    tenantId: z.string().uuid('Invalid tenant ID').optional(),
    courseIds: z.array(z.string().uuid('Invalid course ID')).optional(),
});

export const updatePackageSchema = z.object({
    name: i18nString(false).optional(),
    slug: z.string().min(2).max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')
        .optional(),
    description: i18nString(false).optional(),
    price: z.coerce.number().min(0).optional(),
    seatsCount: z.coerce.number().int().min(1).optional(),
    validityDays: z.coerce.number().int().min(1).optional(),
    isActive: z.coerce.boolean().optional(),
    tenantId: z.string().uuid('Invalid tenant ID').optional(),
    courseIds: z.array(z.string().uuid('Invalid course ID')).optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);


export const packageQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    isActive: z.string().transform(v => v === 'true').optional(),
    tenantId: z.string().uuid().optional(),
    sortBy: z.enum(['createdAt', 'price', 'name']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});