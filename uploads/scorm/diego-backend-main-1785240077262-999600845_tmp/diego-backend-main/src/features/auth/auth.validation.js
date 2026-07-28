import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

const normalizeEnumValue = (allowedValues) => z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(allowedValues),
);

const normalizeDateValue = z.preprocess(
  (value) => {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return value;
  },
  z.date(),
);
const TYPO_EMAIL_SUFFIXES = ['.con', '.comm', '.cmo', '.cm', '.comom', 'gmal.com', 'gmial.com', 'gnail.com'];

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .refine((email) => !TYPO_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix)), {
    message: 'Email domain looks mistyped. Please re-check your email.',
  });

const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => /[A-Z]/.test(v), 'Must include at least one uppercase letter')
  .refine((v) => /[a-z]/.test(v), 'Must include at least one lowercase letter')
  .refine((v) => /[0-9]/.test(v), 'Must include at least one number')
  .refine((v) => /[!?$%&.,@#*]/.test(v), 'Must include at least one special character');

const passwordConfirmation = {
  password: strongPassword,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  consent: z.boolean().optional().default(true),
  preferredLanguage: z.enum(SUPPORTED_LOCALES).optional(),
};

const passwordMatchRefinement = (data, ctx) => {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Passwords don't match",
      path: ['confirmPassword'],
    });
  }
};

const normalizeAccountTypeInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const payload = { ...value };
  if (typeof payload.accountType === 'string') {
    payload.accountType = payload.accountType.trim().toUpperCase();
  }

  return payload;
};

export const startRegistrationSchema = z.object({
  email: emailSchema,
  preferredLanguage: z.enum(SUPPORTED_LOCALES).optional().default('it'),
});

export const verifyRegistrationOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().length(6).regex(/^\d{6}$/),
});


const completePrivateSchema = z
  .object({
    accountType: z.literal('PRIVATE'),
    firstName: z.string({ required_error: 'First name is required' }),
    lastName: z.string({ required_error: 'Last name is required' }),
    birthDate: normalizeDateValue,
    city: z.string({ required_error: 'City is required' }),
    country: z.string({ required_error: 'Country is required' }),
    residenceAddress: z.string({ required_error: 'Residence address is required' }),
    traineeTaxCode: z.string({ required_error: 'Trainee tax code is required' }),
    citizenship: normalizeEnumValue(['ITALIAN', 'FOREIGN']),
    contactNumber: z.string().optional().nullable(),
    membership: z.string().optional().nullable(),
    serviceType: z.string().optional().nullable(),
    ...passwordConfirmation,
  })
  .superRefine(passwordMatchRefinement);

const createCompleteCompanyLikeSchema = (accountType) => z
  .object({
    accountType: z.literal(accountType),
    firstName: z.string({ required_error: 'First name is required' }),
    lastName: z.string({ required_error: 'Last name is required' }),
    companyName: z.string({ required_error: 'Company name is required' }),
    companyAddress: z.string().min(5).max(255).optional().nullable(),
    fiscalAddress: z.string().min(5).max(255).optional().nullable(),
    companyVatNumber: z.string().min(8).max(32).optional().nullable(),
    vatNumber: z.string().min(8).max(32).optional().nullable(),
    companyTaxCode: z.string().optional().nullable(),
    fiscalCode: z.string().optional().nullable(),
    pec: z.string().email('PEC email is required').optional().nullable(),
    uniqueCode: z.string().min(2).max(32).optional().nullable(),
    logoUrl: z.string().url().optional().nullable(),
    companyPosition: z.string().min(2).max(100).optional().nullable(),
    serviceType: z.string().min(2).max(100).optional().nullable(),
    contactNumber: z.string().min(6).max(32).optional().nullable(),
    citizenship: normalizeEnumValue(['ITALIAN', 'FOREIGN']).optional().nullable(),
    ...passwordConfirmation,
  })
  .superRefine((data, ctx) => {
    passwordMatchRefinement(data, ctx);

    if (!data.companyAddress && !data.fiscalAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fiscalAddress'],
        message: 'Company address is required',
      });
    }

    if (!data.companyVatNumber && !data.vatNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vatNumber'],
        message: 'VAT number is required',
      });
    }

    if (!data.companyTaxCode && !data.fiscalCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fiscalCode'],
        message: 'Fiscal code is required',
      });
    }
  })
  .transform((data) => ({
    ...data,
    companyAddress: data.companyAddress ?? data.fiscalAddress,
    companyVatNumber: data.companyVatNumber ?? data.vatNumber,
    companyTaxCode: data.companyTaxCode ?? data.fiscalCode,
  }));

export const completeRegistrationSchema = z.preprocess(
  normalizeAccountTypeInput,
  z.discriminatedUnion('accountType', [
    completePrivateSchema,
    createCompleteCompanyLikeSchema('COMPANY'),
    createCompleteCompanyLikeSchema('LICENSE'),
  ]),
);

export const signinSchema = z.object({
  email: emailSchema,
});

export const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().length(6).regex(/^\d{6}$/),
});

export const resendOtpSchema = z.object({
  email: emailSchema,
  purpose: z.enum(['signup', 'login', 'password_reset']).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const verifyResetOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().length(6).regex(/^\d{6}$/),
});

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    newPassword: z.string().min(6),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });