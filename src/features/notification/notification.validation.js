import { z } from 'zod';
export const notificationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    read: z.string().transform(v => v === 'true').optional(),
    type: z.string().max(100).optional(),
});

export const markReadSchema = z.object({
    notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

export const deleteNotificationsSchema = z.object({
    notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

export const notificationIdParamSchema = z.object({
    notificationId: z.string().uuid('Invalid notification ID'),
});

export const updateAlertOptOutSchema = z.object({
    alertsOptOut: z.boolean(),
});

export const createNotificationSchema = z.object({
    userId: z.string().uuid(),
    type: z.string().min(1).max(100),
    title: z.record(z.string()).refine(o => Object.keys(o).length > 0, {
        message: 'At least one locale required',
    }),
    message: z.record(z.string()).refine(o => Object.keys(o).length > 0, {
        message: 'At least one locale required',
    }),
    tenantId: z.string().uuid().optional(),
});

export const triggerJobSchema = z.object({
    job: z.enum([
        'course_expiry',
        'certificate_expiry',
        'certificate_download_expired',
        'enrollment_expiry',
        'inactive_users',
        'company_digest',
    ]),
});