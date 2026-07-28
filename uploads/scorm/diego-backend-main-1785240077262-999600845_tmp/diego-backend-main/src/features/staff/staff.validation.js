import { z } from 'zod';
import { isCompanyTypeRole } from './staff.config.js';

export const staffRoleEnum = z.enum([
    'TRAINING_PROJECT_MANAGER',
    'CONTENT_MENTOR_TUTOR',
    'PROCESS_TUTOR',
    'PLATFORM_DEVELOPER',
]);

export const staffDocumentTypeEnum = z.enum([
    'CURRICULUM',
    'HEALTH_SAFETY_CERTIFICATE',
    'DIGITAL_SKILLS_CERTIFICATE',
    'IDENTITY_CARD_TAX_CODE',
    'CHAMBER_OF_COMMERCE_CERTIFICATE',
]);

export const createStaffMemberSchema = z.object({
    role: staffRoleEnum,
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    documents: z.array(
        z.object({
            documentType: staffDocumentTypeEnum,
            fileUrl: z.string().min(1),
            fileName: z.string().min(1),
            mimeType: z.string().min(1),
            fileSize: z.number().int().positive().optional(),
        })
    ).optional(),
}).refine(
    (d) => {
        if (isCompanyTypeRole(d.role)) return !!d.companyName;
        return !!d.firstName && !!d.lastName;
    },
    {
        message: 'companyName is required for Platform Developer; firstName/lastName are required for other roles',
        path: ['role'],
    }
);

export const updateStaffMemberSchema = createStaffMemberSchema.optional();

export const uploadStaffDocumentSchema = z.object({
    file: z.string().min(1, 'File upload failed'),
});

