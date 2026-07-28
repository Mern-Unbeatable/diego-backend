import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

// i18n string
const i18nString = (required = true) => {
    const base = z
        .record(z.string().min(1, 'Translation cannot be empty'))
        .refine(
            (obj) => {
                const keys = Object.keys(obj);
                if (keys.length === 0) return false;
                return keys.every((key) => SUPPORTED_LOCALES.includes(key));
            },
            { message: 'Translations must include valid locale keys: ' + SUPPORTED_LOCALES.join(', ') }
        );
    return required ? base : base.optional();
};

// i18n string array for features
const i18nStringArray = (required = true) => {
    const base = z
        .record(
            z.array(z.string().min(1, 'Feature text cannot be empty')).min(1, 'At least one feature is required')
        )
        .refine(
            (obj) => {
                const keys = Object.keys(obj);
                if (keys.length === 0) return false;
                return keys.every((key) => SUPPORTED_LOCALES.includes(key));
            },
            { message: 'Feature arrays must include valid locale keys: ' + SUPPORTED_LOCALES.join(', ') }
        );
    return required ? base : base.optional();
};

const LICENSE_TIERS = ['BEGINNER', 'STANDARD', 'PREMIUM', 'ENTERPRISE'];
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];

export const createLicensePlanSchema = z.object({
    tier: z.enum(LICENSE_TIERS, {
        required_error: 'Tier is required. Must be one of: ' + LICENSE_TIERS.join(', '),
    }),
    name: i18nString(true),
    description: i18nString(false),
    features: i18nStringArray(false),
    supportLevel: i18nString(false),
    maxUsers: z.coerce.number().int().min(1, 'Max users must be at least 1'),
    priceMonthly: z.coerce.number().min(0, 'Monthly price must be 0 or greater').nullable().optional(),
    priceYearly: z.coerce.number().min(0, 'Yearly price must be 0 or greater').nullable().optional(),
    priceAnnual: z.coerce.number().min(0, 'Annual price must be 0 or greater').nullable().optional(),
    storageMb: z.coerce.number().int().min(0, 'Storage must be 0 or greater').default(10240),
    maxCourses: z.coerce.number().int().min(0, 'Max courses must be 0 or greater').default(100),
    isActive: z.coerce.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).default(0),
});

export const updateLicensePlanSchema = z
    .object({
        name: i18nString(false).optional(),
        description: i18nString(false).optional(),
        features: i18nStringArray(false).optional(),
        supportLevel: i18nString(false).optional(),
        maxUsers: z.coerce.number().int().min(1).optional(),
        priceMonthly: z.coerce.number().min(0).nullable().optional(),
        priceYearly: z.coerce.number().min(0).nullable().optional(),
        priceAnnual: z.coerce.number().min(0).nullable().optional(),
        storageMb: z.coerce.number().int().min(0).optional(),
        maxCourses: z.coerce.number().int().min(0).optional(),
        isActive: z.coerce.boolean().optional(),
        sortOrder: z.coerce.number().int().min(0).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
    });
