import { localizeObject, t } from '../../shared/services/translate/translate.service.js';

export const LICENSEE_COURSE_SELECT = {
    id: true,
    courseTitle: true,
    slug: true,
    description: true,
    format: true,
    category: true,
    navigationMode: true,
    thumbnailUrl: true,
    durationMinutes: true,
    duration: true,
    validityDays: true,
    passScorePercent: true,
    isActive: true,
    isB2BOnly: true,
    price: true,
    basePrice: true,
    tenantId: true,
    createdById: true,
    createdAt: true,
    courseStartDate: true,
    courseEndDate: true,
    teacher: { select: { id: true, firstName: true, lastName: true, email: true } },
    tutorUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    _count: { select: { lessons: true, quizzes: true, enrollments: true } },
};

const COURSE_I18N_KEYS = ['courseTitle', 'description'];
const LESSON_I18N_KEYS = ['title'];
const QUIZ_I18N_KEYS = ['quizTitle'];

export function formatLicenseeCourse(course, locale = 'it') {
    if (!course) return null;

    const localized = localizeObject(course, locale, COURSE_I18N_KEYS);
    const lessonCount = course._count?.lessons ?? course.lessons?.length ?? 0;
    const quizCount = course._count?.quizzes ?? 0;

    return {
        ...localized,
        lessonCount,
        quizCount,
        enrollmentCount: course._count?.enrollments ?? null,
        teacher: course.teacher ?? null,
        tutor: course.tutorUser ?? null,
    };
}

export function formatLicenseeLesson(lesson, locale = 'it') {
    if (!lesson) return null;
    return localizeObject(lesson, locale, LESSON_I18N_KEYS);
}

export function formatLicenseeQuiz(quiz, locale = 'it') {
    if (!quiz) return null;
    return localizeObject(quiz, locale, QUIZ_I18N_KEYS);
}

export function formatStudentUser(user) {
    if (!user) return null;
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return {
        ...user,
        fullName: fullName || user.email,
    };
}

/** Preserve most-recent enrollment order when deduplicating student IDs */
export function uniqueStudentIdsOrdered(enrollments) {
    const seen = new Set();
    const ids = [];
    for (const row of enrollments) {
        if (!seen.has(row.userId)) {
            seen.add(row.userId);
            ids.push(row.userId);
        }
    }
    return ids;
}

export function pickLocalizedTitle(i18nField, locale = 'it') {
    return t(i18nField, locale);
}
