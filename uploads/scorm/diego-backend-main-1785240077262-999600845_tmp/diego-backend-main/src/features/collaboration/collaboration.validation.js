
import { z } from 'zod';

export const createCollaborationSchema = z.object({
    companyName: z.string({ required_error: 'Company name is required' }),

    collaborationType: z.enum(['TRAINING_BODY', 'HR_CONSULTANT', 'CONSULTING_COMPANY', 'AGENCY', 'OTHER'], {
        required_error: 'Collaboration type is required',
        invalid_type_error: 'Invalid collaboration type'
    }),

    contactName: z.string({ required_error: 'Contact name is required' }),

    email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),

    telephone: z.string({ required_error: 'Telephone number is required' }),

    companySize: z.enum(['STARTUP', 'SMALL', 'MEDIUM', 'LARGE'], {
        required_error: 'Company size is required',
        invalid_type_error: 'Invalid company size'
    }),

    description: z.string({ required_error: 'Description is required' }),
});

export const updateCollaborationSchema = createCollaborationSchema.partial().extend({
    status: z.enum(['PENDING', 'CONTACTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required for update',
});

