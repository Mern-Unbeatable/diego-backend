import { z } from 'zod';
import { formBoolean } from '../../shared/validation/zodSchemas.js';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];


const i18nString = (required = true) => {
    const base = z
        .object(SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: z.string().min(1).optional() }), {}))
        .refine(obj => Object.keys(obj).length > 0, { message: 'At least one locale translation is required' });
    return required ? base : base.optional();
};


const i18nStringArray = (required = false) => {
    const base = z.array(
        z.object(SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: z.string().min(1).optional() }), {}))
    ).optional();
    return required ? base.refine(arr => arr && arr.length > 0, { message: 'At least one feature is required' }) : base;
};

const looseJson = () => z.record(z.string(), z.any()).optional();

const LESSON_CONTENT_TYPES = [
    'SCORM', 'SCORM_12',
    'PDF', 'WORD', 'EXCEL',
    'VIDEO_UPLOAD',
    'VIDEO_YOUTUBE',
    'FILE',
];

const TRACKED_LESSON_TYPES = new Set(['SCORM', 'SCORM_12']);

const COURSE_FORMATS = [
    'SCORM', 'PDF', 'AICC', 'XAPI', 'VIDEO_RECORDED',
    'FILE', 'EXERCISE', 'HTML_PAGE', 'SURVEY', 'TEST',
    'CHECKLIST', 'SLIDES_CONVERTER', 'LTI',
];
const NAVIGATION_MODES = ['SEQUENTIAL', 'FREE', 'LOCKED_FINAL'];

const lessonSchema = z
    .object({
        title: i18nString(true),
        orderIndex: z.coerce.number().int().min(0).optional(),
        contentType: z.enum(LESSON_CONTENT_TYPES, { required_error: 'contentType is required' }),
        scormPackageUrl: z.string().url('Invalid SCORM package URL').optional(),
        scormVersion: z.enum(['1.2', '2004']).optional().default('1.2'),
        scormEntryPoint: z.string().min(1).optional(),
        contentUrl: z.string().url().optional(),
        youtubeUrl: z.string().url().optional(),
        durationSecs: z.coerce.number().int().positive().optional(),
        isRequired: formBoolean(true),
        isLocked: formBoolean(false),
    })
    .refine(d => {
        if (TRACKED_LESSON_TYPES.has(d.contentType)) return !!d.scormPackageUrl;
        return true;
    }, { message: 'scormPackageUrl is required for SCORM lessons', path: ['scormPackageUrl'] })
    .refine(d => {
        if (TRACKED_LESSON_TYPES.has(d.contentType)) return !!d.scormEntryPoint;
        return true;
    }, { message: 'scormEntryPoint is required for SCORM lessons (e.g. "index_lms.html")', path: ['scormEntryPoint'] })
    .refine(d => {
        if (d.contentType === 'VIDEO_YOUTUBE') return !!d.youtubeUrl;
        return true;
    }, { message: 'youtubeUrl is required for VIDEO_YOUTUBE lessons', path: ['youtubeUrl'] })
    .refine(d => {
        const needsUrl = ['PDF', 'WORD', 'EXCEL', 'VIDEO_UPLOAD', 'FILE'];
        if (needsUrl.includes(d.contentType)) return !!d.contentUrl;
        return true;
    }, { message: 'contentUrl is required for this lesson type', path: ['contentUrl'] });


const pricingTierSchema = z.object({
    id: z.string().uuid().optional(),
    minUsers: z.coerce.number().int().min(1),
    maxUsers: z.coerce.number().int().min(1).optional().nullable(),
    pricePerUser: z.coerce.number().min(0).optional(),
    price: z.coerce.number().min(0).optional(),
    sortOrder: z.coerce.number().int().default(0),
    isActive: z.coerce.boolean().default(true),
    currency: z.string().default('EUR').optional(),

    label: i18nString(false),
}).transform((tier) => ({
    ...tier,
    pricePerUser: tier.pricePerUser ?? tier.price,
})).refine(
    d => d.pricePerUser !== undefined && d.pricePerUser !== null,
    { message: 'pricePerUser is required', path: ['pricePerUser'] }
).refine(
    d => d.maxUsers == null || d.maxUsers >= d.minUsers,
    { message: 'maxUsers must be >= minUsers', path: ['maxUsers'] }
);


const companyFeatureSchema = z.object({
    id: z.string().uuid().optional(),
    type: z.enum(['pricing', 'feature']).default('feature'),
    minUsers: z.coerce.number().int().min(1).optional(),
    maxUsers: z.coerce.number().int().min(1).optional().nullable(),
    price: z.coerce.number().min(0).optional(),
    currency: z.string().default('EUR').optional(),
    label: i18nString(true),
}).refine(
    d => {
        if (d.type === 'pricing') {
            return d.minUsers !== undefined && d.price !== undefined;
        }
        return true;
    },
    { message: 'minUsers and price are required for pricing type', path: ['minUsers'] }
).refine(
    d => d.maxUsers == null || d.maxUsers >= (d.minUsers || 0),
    { message: 'maxUsers must be >= minUsers', path: ['maxUsers'] }
);

const baseCourseSchema = z.object({
    courseTitle: i18nString(true),
    slug: z.string().min(2).max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')
        .optional(),
    trainingPlanTitle: i18nString(false),
    category: z.string({ required_error: 'category is required' }),
    trainingPlanId: z.string().max(100).optional(),
    trainingActionId: z.string().max(100).optional(),
    description: i18nString(false),
    financingCompany: i18nString(false),
    courseStartDate: z.coerce.date().optional(),
    courseEndDate: z.coerce.date().optional(),

    format: z.enum(COURSE_FORMATS, { required_error: 'format is required' }),
    navigationMode: z.enum(NAVIGATION_MODES).default('SEQUENTIAL'),

    durationMinutes: z.coerce.number().int().positive().optional(),
    validityDays: z.coerce.number().int().min(1).default(90),
    passScorePercent: z.coerce.number().int().min(0).max(100).default(80),
    duration: z.coerce.number().int().positive().optional(),

    cig: z.string().max(50).optional(),
    cup: z.string().max(50).optional(),
    cip: z.string().max(50).optional(),

    type: i18nString(false),
    scormPackageUrl: z.string().url().optional(),
    courseLocation: i18nString(false),
    selectType: i18nString(false),
    category: z.string({ required_error: 'category is required' }),
    sector: i18nString(false),
    fund: i18nString(false),
    methodology: i18nString(false),
    trainingProjectManager: i18nString(false),
    tutorName: i18nString(false),
    vat: i18nString(false),
    thumbnailUrl: z.string().url().optional(),
    documentUrl: z.string().url().optional(),
    videoUrl: z.string().url().optional(),

    price: z.coerce.number().min(0).default(0),
    basePrice: z.coerce.number().default(0),
    isActive: z.coerce.boolean().default(true),
    isB2BOnly: z.coerce.boolean().default(false),

    teacherId: z.string().uuid().optional(),
    tutorId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),

    lessons: z.array(lessonSchema).optional(),

    singleUserPackageId: z.string().uuid().optional(),
    companyPackageId: z.string().uuid().optional(),
    code: looseJson(),

    pricingTiers: z.array(pricingTierSchema).max(15).optional(),
});

const dateRefinement = (schema) =>
    schema.refine(d => {
        if (d.courseStartDate && d.courseEndDate) return d.courseEndDate > d.courseStartDate;
        return true;
    }, { message: 'courseEndDate must be after courseStartDate', path: ['courseEndDate'] });

export const createCourseSchema = dateRefinement(baseCourseSchema);

export const updateCourseSchema = dateRefinement(
    baseCourseSchema.partial().refine(
        d => Object.keys(d).length > 0,
        { message: 'At least one field must be provided for update' }
    )
);

export const courseQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    format: z.enum(COURSE_FORMATS).optional(),
    isActive: z.string().transform(v => v === 'true').optional(),
    isB2BOnly: z.string().transform(v => v === 'true').optional(),
    tenantId: z.string().uuid().optional(),
    sortBy: z.enum(['createdAt', 'price', 'courseStartDate']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createLessonSchema = lessonSchema;

export const updateLessonSchema = lessonSchema.optional().refine(
    d => Object.keys(d).length > 0,
    { message: 'At least one field must be provided for update' }
);

export const pricingTierInputSchema = pricingTierSchema;