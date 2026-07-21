// src/features/user/user.validation.js
import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

export const updateProfileSchema = z
  .object({
    firstName: z
      .string().min(2).max(50)
      .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Invalid characters in first name')
      .optional(),
    lastName: z
      .string().min(2).max(50)
      .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Invalid characters in last name')
      .optional(),
    residenceAddress: z.string().min(5).max(255).optional(),
    city: z.string().min(2).max(100).optional(),
    country: z.string().min(2).max(100).optional(),
    traineeTaxCode: z.string().min(11).max(32).optional(),
    companyName: z.string().min(2).max(120).optional(),
    companyAddress: z.string().min(5).max(255).optional(),
    companyTaxCode: z.string().min(11).max(32).optional(),
    companyVatNumber: z.string().min(8).max(32).optional(),
    companyPosition: z.string().min(2).max(100).optional(),
    serviceType: z.string().min(2).max(100).optional(),
    contactNumber: z.string().min(6).max(32).optional(),
    preferredLanguage: z.enum(SUPPORTED_LOCALES).optional(),
    citizenship: z.enum(['ITALIAN', 'FOREIGN']).optional(),
    avatar: z.string().url().optional(), // ✅ Using 'avatar' to match Prisma
  })
  .refine(
    (d) =>
      d.firstName !== undefined ||
      d.lastName !== undefined ||
      d.residenceAddress !== undefined ||
      d.city !== undefined ||
      d.country !== undefined ||
      d.traineeTaxCode !== undefined ||
      d.companyName !== undefined ||
      d.companyAddress !== undefined ||
      d.companyTaxCode !== undefined ||
      d.companyVatNumber !== undefined ||
      d.companyPosition !== undefined ||
      d.serviceType !== undefined ||
      d.contactNumber !== undefined ||
      d.preferredLanguage !== undefined ||
      d.citizenship !== undefined ||
      d.avatar !== undefined,
    { message: 'At least one field must be provided' },
  );

export const updateAvatarSchema = z.object({
  avatar: z.string().url('Invalid avatar URL'),
});
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

export const setVerifiedSchema = z.object({
  isVerified: z.boolean({ required_error: 'isVerified (boolean) is required' }),
});

export const setLevelSchema = z.object({
  level: z.enum(
    ['PRIVATE_USER', 'COMPANY_ADMIN', 'COMPANY_EMPLOYEE', 'LICENSE_USER', 'MASTER_ADMIN', 'PLATFORM_ADMIN'],
    { required_error: 'level is required' },
  ),
});

export const setStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED'], { required_error: 'status is required' }),
});

export const assignPackageSeatSchema = z.object({
  packagePurchaseId: z.string().uuid(),
  courseId: z.string().uuid(),
  userId: z.string().uuid(),
  assignedEmail: z.string().email(),
  expiresAt: z.coerce.date().optional(),
});