import { z } from 'zod';

export const updateEmergencyControlsSchema = z.object({
    downloadPermissionEnabled: z.boolean().optional(),
    newUserRegistrationEnabled: z.boolean().optional(),
    paymentProcessingEnabled: z.boolean().optional(),
    maintenanceModeEnabled: z.boolean().optional(),
    maintenanceMessage: z.record(z.string()).optional().nullable(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one setting must be provided' },
);

export const updateCertificateArchivePlanSchema = z.object({
    enabled: z.boolean().optional(),
    name: z.record(z.string()).optional(),
    description: z.record(z.string()).optional(),
    priceEur: z.number().positive().max(99999).optional(),
    currency: z.string().length(3).optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    storageMb: z.number().int().min(1).max(1048576).optional(),
    freeDownloadDays: z.number().int().min(1).max(365).optional(),
    legalRetentionYears: z.number().int().min(1).max(50).optional(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one archive plan field must be provided' },
);

export const updateFinancialSettingsSchema = z.object({
    currency: z.string().length(3).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    stripeEnabled: z.boolean().optional(),
    paypalEnabled: z.boolean().optional(),
    applePayEnabled: z.boolean().optional(),
    googlePayEnabled: z.boolean().optional(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one financial setting must be provided' },
);

export const updateSystemSettingsSchema = z.object({
    smtpHost: z.string().max(255).optional().nullable(),
    smtpPort: z.number().int().min(1).max(65535).optional().nullable(),
    smtpFromEmail: z.string().email().optional().nullable(),
    emailTemplates: z.record(z.object({
        enabled: z.boolean().optional(),
        subject: z.union([z.string().min(1), z.record(z.string())]).optional(),
        bodyHtml: z.union([z.string().min(1), z.record(z.string())]).optional(),
    })).optional(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one system setting must be provided' },
);

export const updateBrandSettingsSchema = z.object({
    platformName: z.string().min(1).max(120).optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Primary color must be a valid hex code').optional(),
    platformLogoUrl: z.string().url().optional().nullable(),
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one brand setting must be provided' },
);

export const updateWebhookSettingsSchema = z.object({
    webhooks: z.record(z.object({
        enabled: z.boolean().optional(),
        url: z.union([z.string().url(), z.literal('')]).optional().nullable(),
    })),
}).refine(
    (data) => Object.keys(data.webhooks || {}).length > 0,
    { message: 'At least one webhook must be provided' },
);

export const testSmsSchema = z.object({
    to: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
    body: z.string().min(1).max(1600).optional(),
}).superRefine((data, ctx) => {
    if (!data.to || data.to.length < 8) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Phone number is required (e.g. +8801825445033)',
            path: ['to'],
        });
    }
});
