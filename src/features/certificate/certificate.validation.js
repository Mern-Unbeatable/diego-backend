import { z } from 'zod';

const booleanFromFormData = z.preprocess((val) => {
    if (typeof val === 'string') return val === 'true' || val === '1';
    if (typeof val === 'boolean') return val;
    return val;
}, z.boolean());

const signatorySchema = z.object({
    name: z.string().min(1),
    title: z.string().optional(),
    position: z.enum(['left', 'right']).optional(),
});

const certificateTemplateConfigSchema = z.object({
    layout: z.enum(['landscape', 'portrait']).optional(),
    titleText: z.string().optional(),
    presentedToLabel: z.string().optional(),
    completionLabel: z.string().optional(),
    hostedByLabel: z.string().optional(),
    showQrCode: booleanFromFormData.optional(),
    showIssueDate: booleanFromFormData.optional(),
    colors: z.object({
        primary: z.string().optional(),
    }).optional(),
    signatories: z.array(signatorySchema).max(2).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
}).optional();

export const generateCertificateSchema = z.object({
    enrollmentId: z.string().uuid('Invalid enrollment ID'),
    companyLogoUrl: z.string().url('Invalid logo URL').optional(),
    issueDate: z.coerce.date().optional(),
    expiryDate: z.coerce.date().optional(),
    forceComplete: booleanFromFormData.default(false).optional(),
    certificateTemplateConfig: z.preprocess((val) => {
        if (typeof val === 'string') {
            try { return JSON.parse(val); } catch { return val; }
        }
        return val;
    }, certificateTemplateConfigSchema).optional(),
});

export const updateCertificateSchema = z.object({
    status: z.enum(['PENDING', 'ISSUED', 'ARCHIVED', 'REVOKED']).optional(),
    companyLogoUrl: z.string().url('Invalid logo URL').optional(),
    downloadableUntil: z.coerce.date().optional(),
    editUnlockedOnce: booleanFromFormData.optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);

export const verifyCertificateSchema = z.object({
    certificateId: z.string().uuid('Invalid certificate ID'),
});
