import { z } from 'zod';
export const generateCertificateSchema = z.object({
    enrollmentId: z.string().uuid('Invalid enrollment ID'),
    companyLogoUrl: z.string().url('Invalid logo URL').optional(),
    issueDate: z.coerce.date().optional(),
    expiryDate: z.coerce.date().optional(),
    forceComplete: z.boolean().default(false).optional(),
});

export const updateCertificateSchema = z.object({
    status: z.enum(['PENDING', 'ISSUED', 'ARCHIVED', 'REVOKED']).optional(),
    companyLogoUrl: z.string().url('Invalid logo URL').optional(),
    downloadableUntil: z.coerce.date().optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);


export const verifyCertificateSchema = z.object({
    certificateId: z.string().uuid('Invalid certificate ID'),
});