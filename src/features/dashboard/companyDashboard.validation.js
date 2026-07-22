import { z } from 'zod';

export const companyDashboardQuerySchema = z.object({
    expiringDays: z.coerce.number().int().min(1).max(90).default(14),
});
