
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

export const createTicketSchema = z.object({
    subject: z.string().min(3, 'Subject must be at least 3 characters').max(200, 'Subject too long'),
    message: z.string().min(10, 'Message must be at least 10 characters'),
    question: i18nString(false),
    autoTranslateQuestion: z.coerce.boolean().optional().default(true),
    attachments: z.string().optional(),
});


export const updateTicketSchema = z.object({
    answer: i18nString(true),
    question: i18nString(false).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
);


export const updateTicketStatusSchema = z.object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
});

export const ticketQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    priority: z.enum(['CRITICAL', 'MEDIUM', 'LOW']).optional(),
    userId: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'status', 'ticketNumber']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});