import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

const i18nString = (required = true) => {
    const base = z
        .record(z.string(), z.string().min(1))
        .refine((obj) => Object.keys(obj).length > 0, {
            message: 'At least one locale is required',
        })
        .refine(
            (obj) => Object.keys(obj).every((k) => SUPPORTED_LOCALES.includes(k)),
            { message: `Locale keys must be one of: ${SUPPORTED_LOCALES.join(', ')}` }
        );
    return required ? base : base.optional();
};

export const QUESTION_TYPES = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'FREE_TEXT'];

const optionSchema = z.object({
    id: z.string().min(1, 'Option id is required'),
    text: i18nString(true),
    isCorrect: z.boolean().default(false),
});

const questionSchema = z.object({
    id: z.string().min(1, 'Question id is required'),
    text: i18nString(true),
    type: z.enum(QUESTION_TYPES).default('SINGLE'),
    options: z.array(optionSchema).optional().default([]),
    expectedAnswers: z.array(z.string().min(1)).optional(),
    requiresManualGrading: z.boolean().optional().default(false),
    points: z.number().int().min(1).default(1),
}).superRefine((q, ctx) => {
    if (q.type === 'FREE_TEXT') {
        if (q.options && q.options.length > 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FREE_TEXT questions cannot have options', path: ['options'] });
        }
        if (!q.requiresManualGrading && (!q.expectedAnswers || q.expectedAnswers.length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'FREE_TEXT questions need expectedAnswers, or set requiresManualGrading: true',
                path: ['expectedAnswers'],
            });
        }
        return;
    }

    if (!q.options || q.options.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least 2 options required', path: ['options'] });
        return;
    }

    if (q.type === 'TRUE_FALSE' && q.options.length !== 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TRUE_FALSE questions must have exactly 2 options', path: ['options'] });
    }

    const correctCount = q.options.filter((o) => o.isCorrect).length;

    if (correctCount === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one option must be marked correct', path: ['options'] });
    }

    if ((q.type === 'SINGLE' || q.type === 'TRUE_FALSE') && correctCount !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${q.type} must have exactly 1 correct option`, path: ['options'] });
    }
});

export const createQuizSchema = z.object({
    quizTitle: i18nString(true),
    quizType: z.enum(['PRE_TEST', 'POST_TEST', 'FINAL_TEST'], { required_error: 'quizType is required' }),
    passScorePercent: z.number().int().min(0).max(100).default(80),
    minimumScorePercent: z.number().int().min(0).max(100).default(0),
    failScorePercent: z.number().int().min(0).max(100).default(0),
    isActive: z.boolean().default(true),
    isPublished: z.boolean().default(false),
    questions: z.array(questionSchema).min(1, 'At least one question required').optional(),
    feedback: i18nString(false),
    maxAttempts: z.number().int().min(1).optional(),
});

export const updateQuizSchema = createQuizSchema.partial().refine(
    (d) => Object.keys(d).length > 0,
    { message: 'At least one field must be provided' },
);

export const quizQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    quizType: z.enum(['PRE_TEST', 'POST_TEST', 'FINAL_TEST']).optional(),
    isPublished: z.string().transform((v) => v === 'true').optional(),
    isActive: z.string().transform((v) => v === 'true').optional(),
});

export const submitQuizSchema = z.object({
    enrollmentId: z.string().uuid({ message: 'enrollmentId is required' }),
    answers: z
        .array(
            z.object({
                questionId: z.string().min(1),
                selectedOptionIds: z.array(z.string().min(1)).optional(),
                textAnswer: z.string().optional(),
            }).refine(
                (a) => (a.selectedOptionIds?.length > 0) || (a.textAnswer?.trim().length > 0),
                { message: 'Either selectedOptionIds or textAnswer must be provided' },
            ),
        )
        .min(1, 'At least one answer required'),
});

export const quizAttemptQuerySchema = z.object({
    enrollmentId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const gradeManualAnswerSchema = z.object({
    questionId: z.string().min(1),
    isCorrect: z.boolean(),
});