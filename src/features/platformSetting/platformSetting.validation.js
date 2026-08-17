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
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one financial setting must be provided' },
);
