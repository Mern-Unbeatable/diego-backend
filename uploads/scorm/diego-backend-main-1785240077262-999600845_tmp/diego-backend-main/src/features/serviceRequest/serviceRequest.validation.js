import { z } from 'zod';
import { SERVICE_REQUEST_STATUSES } from './serviceRequest.config.js';

const statusEnum = z.enum(SERVICE_REQUEST_STATUSES);

const truthy = z
    .union([z.literal(true), z.literal('true'), z.literal('on'), z.literal('1')])
    .transform(() => true);

export const createServiceRequestSchema = z
    .object({

        serviceName: z.string().optional(),

        firstName: z.string().trim().min(1, 'First name is required'),
        lastName: z.string().trim().min(1, 'Last name is required'),

        companyName: z.string().trim().optional().or(z.literal('')),
        vatNumber: z.string().trim().optional().or(z.literal('')),

        phone: z.string().trim().min(5, 'Phone number is required'),
        email: z.string().trim().email('A valid email is required'),
        message: z.string().max(5000).optional().or(z.literal('')),

    });

export const serviceRequestParamsSchema = z.object({
    serviceRequestId: z.string().uuid('Invalid service request id'),
});

export const serviceRequestQuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: statusEnum.optional(),

    search: z.string().optional(),
    sortBy: z.enum(['createdAt', 'status', 'lastName']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const updateServiceRequestStatusSchema = z.object({
    status: statusEnum,
    adminNote: z.string().max(2000).optional(),
});