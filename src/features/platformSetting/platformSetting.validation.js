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
