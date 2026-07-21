
import { z } from 'zod';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

const i18nString = (required = true) => {
    const base = z
        .record(z.string().min(1, 'Translation cannot be empty'))
        .refine(
            obj => {
                const keys = Object.keys(obj);
                if (keys.length === 0) return false;
                return keys.every(key => SUPPORTED_LOCALES.includes(key));
            },
            { message: 'At least one valid locale translation is required' }
        );
    return required ? base : base.optional();
};

const LESSON_CONTENT_TYPES = [
    'SCORM', 'SCORM_12',
    'PDF', 'WORD', 'EXCEL',
    'VIDEO_UPLOAD',
    'VIDEO_YOUTUBE',
    'FILE',
];

const TRACKED_TYPES = ['SCORM', 'SCORM_12'];

export const baseLessonSchema = z.object({
    title: i18nString(true),
    orderIndex: z.coerce.number().int().min(0, 'Order index must be 0 or greater').optional(),
    contentType: z.enum(LESSON_CONTENT_TYPES, {
        required_error: 'contentType is required. Must be one of: ' + LESSON_CONTENT_TYPES.join(', '),
    }),
    scormPackageUrl: z.string().url('Invalid SCORM package URL').optional(),
    scormVersion: z.enum(['1.2', '2004']).optional().default('1.2'),
    scormEntryPoint: z.string().min(1).optional(),
    contentUrl: z.string().url('Invalid URL format').optional(),
    youtubeUrl: z.string().url('Invalid YouTube URL').optional(),
    durationSecs: z.coerce.number().int().positive('Duration must be a positive number').optional(),
    isRequired: z.coerce.boolean().default(true),
    isLocked: z.coerce.boolean().default(false),
})
    .refine(
        data => TRACKED_TYPES.includes(data.contentType) ? !!data.scormPackageUrl : true,
        { message: 'scormPackageUrl is required for SCORM lessons', path: ['scormPackageUrl'] }
    )
    .refine(
        data => TRACKED_TYPES.includes(data.contentType) ? !!data.scormEntryPoint : true,
        { message: 'scormEntryPoint is required for SCORM lessons (e.g. "index_lms.html")', path: ['scormEntryPoint'] }
    )
    .refine(
        data => data.contentType === 'VIDEO_YOUTUBE' ? !!data.youtubeUrl : true,
        { message: 'youtubeUrl is required for VIDEO_YOUTUBE lessons', path: ['youtubeUrl'] }
    )
    .refine(
        data => {
            const needsUrl = ['PDF', 'WORD', 'EXCEL', 'VIDEO_UPLOAD', 'FILE'];
            return needsUrl.includes(data.contentType) ? !!data.contentUrl : true;
        },
        { message: 'contentUrl is required for this lesson type', path: ['contentUrl'] }
    );

export const createLessonSchema = baseLessonSchema;

export const updateLessonSchema = z.object({
    title: i18nString(false).optional(),
    orderIndex: z.coerce.number().int().min(0).optional(),
    contentType: z.enum(LESSON_CONTENT_TYPES).optional(),
    scormPackageUrl: z.string().url().optional().nullable(),
    scormVersion: z.enum(['1.2', '2004']).optional(),
    scormEntryPoint: z.string().min(1).optional().nullable(),
    contentUrl: z.string().url().optional().nullable(),
    youtubeUrl: z.string().url().optional().nullable(),
    // ✅ COERCE durationSecs to number
    durationSecs: z.coerce.number().int().positive().optional(),
    isRequired: z.coerce.boolean().optional(),
    isLocked: z.coerce.boolean().optional(),
})
    .refine(
        data => {
            const hasField = Object.keys(data).some(key => data[key] !== undefined);
            return hasField;
        },
        {
            message: 'At least one field must be provided for update',
            path: ['_error']
        }
    );


export const reorderLessonsSchema = z.object({
    lessons: z
        .array(
            z.object({
                id: z.string().uuid('Invalid lesson ID format'),

                orderIndex: z.coerce.number().int().min(0, 'Order index must be 0 or greater'),
            })
        )
        .min(1, 'At least one lesson is required')
        .refine(
            items => {
                const indices = items.map(i => i.orderIndex);
                return new Set(indices).size === indices.length;
            },
            { message: 'Duplicate order indices are not allowed' }
        ),
});



export const trackProgressSchema = z.object({
    completed: z.coerce.boolean().default(false),
    timeSpentSecs: z.coerce.number().int().min(0, 'Time cannot be negative').default(0),
});

export const scormLaunchSchema = z.object({
    enrollmentId: z.string().uuid('Invalid enrollment ID'),
    lessonId: z.string().uuid('Invalid lesson ID'),
});

export const scormCommitSchema = z.object({
    sessionId: z.string().uuid('Invalid session ID'),
    cmiData: z.record(z.any()).optional(),
});

export const scormFinishSchema = z.object({
    sessionId: z.string().uuid('Invalid session ID'),
    cmiData: z.record(z.any()).optional(),
});