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

export const createCourseReviewSchema = z.object({
    courseId: z.string().uuid('Invalid course ID'),
    rating: z.number().int().min(1, 'Rating min 1').max(5, 'Rating max 5'),
    comment: i18nString(false),
});

export const updateCourseReviewSchema = z.object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: i18nString(false),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });