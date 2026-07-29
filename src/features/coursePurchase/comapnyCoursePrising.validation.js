import { z } from 'zod';

export const assignSeatSchema = z.object({
  companyCoursePurchaseId: z.string().uuid(),
  employeeUserId: z.string().uuid('Invalid employee user ID'),
});

export const bulkAssignSeatsSchema = z.object({
  companyCoursePurchaseId: z.string().uuid(),
  employeeUserIds: z.array(z.string().uuid()).min(1, 'At least one employee is required'),
});

export const inviteEmployeeSchema = z.object({
  companyCoursePurchaseId: z.string().uuid(),
  email: z.string().email('Invalid email'),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  jobTitle: z.string().optional(),
});

export const sendAccessLinkSchema = z.object({
  enrollmentId: z.string().uuid('Invalid enrollment ID'),
});