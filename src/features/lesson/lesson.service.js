
import { prisma } from '../../config/db.js';
import { localizeObject, t } from '../../shared/services/translate/translate.service.js';
import {
    assertCanAccessCourse,
    assertCanManageCourse,
} from '../course/course.permission.js';
import { enrollmentService } from '../enrollment/enrollment.service.js';
import { certificateService } from '../certificate/certificate.service.js';
import { BadRequestError, NotFoundError } from '../../shared/globals/helpers/error-handler.js';
import { ensureScormPackagePrepared, looksLikeScormZipUrl } from '../../shared/scorm/scormPackage.util.js';

const MIN_WATCH_PERCENT = 90;
const DEFAULT_MIN_READ_SECS = 120;
const DOCUMENT_TYPES = ['PDF', 'FILE', 'WORD', 'EXCEL'];

const LESSON_I18N_KEYS = ['title'];
const SCORM_TYPES = ['SCORM', 'SCORM_12'];

export class LessonService {

    _isScorm(contentType) {
        return SCORM_TYPES.includes(contentType);
    }

    _isLessonCompleted(lesson, progress) {
        if (!progress) return false;
        if (this._isScorm(lesson.contentType)) {
            return ['COMPLETED', 'PASSED'].includes(progress.scormStatus);
        }
        if (progress.completed === true) return true;

        const watchPercent = progress.watchPercent ?? 0;
        if (watchPercent >= MIN_WATCH_PERCENT) return true;

        const timeSpentSecs = progress.timeSpentSecs ?? 0;
        const durationSecs = lesson.durationSecs ?? null;
        const effectiveMinSecs = durationSecs && durationSecs > 0
            ? durationSecs
            : (DOCUMENT_TYPES.includes(lesson.contentType) ? DEFAULT_MIN_READ_SECS : null);

        if (effectiveMinSecs != null) {
            return timeSpentSecs >= Math.ceil(effectiveMinSecs * (MIN_WATCH_PERCENT / 100));
        }

        return false;
    }

    /** SEQUENTIAL = previous required lessons must be done; FREE = all open; LOCKED_FINAL = same as FREE until final test */
    _isLessonAccessible(lesson, sortedLessons, progressMap, navigationMode = 'SEQUENTIAL') {
        if (navigationMode === 'FREE' || navigationMode === 'LOCKED_FINAL') {
            if (lesson.isLocked) return false;
            return true;
        }

        const idx = sortedLessons.findIndex(l => l.id === lesson.id);
        if (idx < 0) return false;

        for (let i = 0; i < idx; i++) {
            const prev = sortedLessons[i];
            if (!prev.isRequired) continue;
            const prevProgress = progressMap.get(prev.id);
            if (!this._isLessonCompleted(prev, prevProgress)) return false;
        }
        return true;
    }

    _buildAccessProgressMap(sortedLessons, progressMap) {
        const accessProgressMap = new Map(progressMap);
        for (const courseLesson of sortedLessons) {
            const progress = accessProgressMap.get(courseLesson.id);
            if (progress && this._isLessonCompleted(courseLesson, progress)) {
                accessProgressMap.set(courseLesson.id, { ...progress, completed: true });
            }
        }
        return accessProgressMap;
    }

    _formatLessonProgressRow(lesson, progress, locale, { sortedLessons, progressMap, navigationMode }) {
        const isScorm = this._isScorm(lesson.contentType);
        const isCompleted = this._isLessonCompleted(lesson, progress);
        const isAccessible = this._isLessonAccessible(lesson, sortedLessons, progressMap, navigationMode);

        return {
            lessonId: lesson.id,
            title: t(lesson.title, locale),
            orderIndex: lesson.orderIndex,
            contentType: lesson.contentType,
            isTracked: isScorm,
            isRequired: lesson.isRequired,
            isLocked: lesson.isLocked,
            isAccessible,
            isCompleted,
            durationSecs: lesson.durationSecs ?? null,
            contentUrl: lesson.contentUrl ?? null,
            youtubeUrl: lesson.youtubeUrl ?? null,
            scormPackageUrl: isScorm ? (lesson.scormPackageUrl ?? null) : null,
            scormEntryPoint: isScorm ? (lesson.scormEntryPoint ?? null) : null,
            timeSpentSecs: progress?.timeSpentSecs ?? 0,
            watchPercent: progress?.watchPercent ?? 0,
            lastPositionSecs: progress?.lastPositionSecs ?? 0,
            startedAt: progress?.startedAt ?? null,
            completedAt: progress?.completedAt ?? null,
            scormStatus: isScorm ? (progress?.scormStatus ?? 'NOT_ATTEMPTED') : null,
            scormScore: isScorm ? (progress?.scormScore ?? null) : null,
            scormPassed: isScorm ? (progress?.scormPassed ?? false) : null,
        };
    }

    async getLessonsByCourse(courseId, locale = 'it', queryParams = {}, user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: {
                id: true,
                courseTitle: true,
                slug: true,
                tenantId: true,
                createdById: true,
                isActive: true,
                navigationMode: true,
            },
        });
        if (!course) throw new NotFoundError('Course not found');

        if (user) await assertCanAccessCourse(course, user, prisma);

        const where = { courseId };

        if (queryParams.contentType) where.contentType = queryParams.contentType;
        if (queryParams.isRequired !== undefined) where.isRequired = queryParams.isRequired === 'true';
        if (queryParams.isLocked !== undefined) where.isLocked = queryParams.isLocked === 'true';

        if (queryParams.search) {
            where.OR = [
                { title: { path: ['it'], string_contains: queryParams.search } },
                { title: { path: ['en'], string_contains: queryParams.search } },
                { title: { path: ['fr'], string_contains: queryParams.search } },
                { title: { path: ['zh'], string_contains: queryParams.search } },
            ];
        }

        const orderBy = queryParams.sortBy === 'durationSecs'
            ? { durationSecs: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' }
            : { orderIndex: 'asc' };

        const [lessons, total] = await Promise.all([
            prisma.lesson.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    _count: { select: { progress: true } },
                },
            }),
            prisma.lesson.count({ where }),
        ]);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                courseId,
                courseTitle: t(course.courseTitle, locale),
                navigationMode: course.navigationMode,
            },
            lessons: lessons.map(lesson => ({
                ...localizeObject(lesson, locale, LESSON_I18N_KEYS),
                viewCount: lesson._count.progress,
                isTracked: this._isScorm(lesson.contentType),
            })),
        };
    }

    async getLessonById(id, locale = 'it', includeProgress = false, userId = null, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id },
            include: {
                course: { select: { id: true, tenantId: true, createdById: true, isActive: true } },
                _count: { select: { progress: true } },
                ...(includeProgress && userId && {
                    progress: {
                        where: { enrollment: { userId } },
                        select: {
                            timeSpentSecs: true,
                            completed: true,
                            completedAt: true,
                            startedAt: true,
                            scormStatus: true,
                            scormScore: true,
                            scormPassed: true,
                        },
                    },
                }),
            },
        });

        if (!lesson) return null;
        if (user) await assertCanAccessCourse(lesson.course, user, prisma);

        return {
            ...localizeObject(lesson, locale, LESSON_I18N_KEYS),
            viewCount: lesson._count.progress,
            isTracked: ['SCORM', 'SCORM_12'].includes(lesson.contentType),
            userProgress: lesson.progress?.[0] || null,
        };
    }


    async createLesson(courseId, data, user = null) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, slug: true, tenantId: true, createdById: true, isActive: true },
        });
        if (!course) throw new NotFoundError('Course not found');
        if (user) assertCanManageCourse(course, user, 'add lessons to');

        if (['SCORM', 'SCORM_12'].includes(data.contentType)) {
            if (!data.scormPackageUrl) throw new BadRequestError('scormPackageUrl is required for SCORM lessons');
        }

        if (['SCORM', 'SCORM_12'].includes(data.contentType) && data.scormPackageUrl) {
            try {
                const prepared = await ensureScormPackagePrepared(
                    data.scormPackageUrl,
                    data.scormEntryPoint,
                    data.scormVersion ?? '1.2',
                );
                data.scormPackageUrl = prepared.scormPackageUrl;
                data.scormEntryPoint = prepared.scormEntryPoint;
            } catch (error) {
                throw new BadRequestError(error.message || 'Failed to prepare SCORM package');
            }
        }

        if (['SCORM', 'SCORM_12'].includes(data.contentType) && looksLikeScormZipUrl(data.scormPackageUrl)) {
            throw new BadRequestError(
                'SCORM package could not be extracted. Upload a single SCORM .zip (not AllGolfExamples bundle).',
            );
        }

        if (['SCORM', 'SCORM_12'].includes(data.contentType) && !data.scormEntryPoint) {
            throw new BadRequestError('scormEntryPoint could not be resolved for this SCORM package');
        }

        const nonScormTypes = ['PDF', 'WORD', 'EXCEL', 'VIDEO_UPLOAD', 'FILE'];
        if (nonScormTypes.includes(data.contentType) && !data.contentUrl) {
            throw new BadRequestError('contentUrl is required for this lesson type');
        }
        if (data.contentType === 'VIDEO_YOUTUBE' && !data.youtubeUrl) {
            throw new BadRequestError('youtubeUrl is required for VIDEO_YOUTUBE lessons');
        }

        if (data.orderIndex === undefined) {
            const maxOrder = await prisma.lesson.aggregate({
                where: { courseId },
                _max: { orderIndex: true },
            });
            data.orderIndex = (maxOrder._max.orderIndex ?? -1) + 1;
        }

        const isScorm = ['SCORM', 'SCORM_12'].includes(data.contentType);

        return prisma.lesson.create({
            data: {
                title: data.title,
                orderIndex: data.orderIndex,
                contentType: data.contentType,
                courseId,

                scormPackageUrl: isScorm ? data.scormPackageUrl : null,
                scormVersion: isScorm ? (data.scormVersion ?? '1.2') : null,
                scormEntryPoint: isScorm ? data.scormEntryPoint : null,

                contentUrl: !isScorm ? (data.contentUrl ?? null) : null,
                youtubeUrl: data.contentType === 'VIDEO_YOUTUBE' ? data.youtubeUrl : null,
                durationSecs: data.durationSecs ?? null,
                isRequired: data.isRequired ?? true,
                isLocked: data.isLocked ?? false,
            },
            include: {
                _count: { select: { progress: true } },
            },
        });
    }

    async updateLesson(id, data, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id },
            select: {
                id: true,
                courseId: true,
                contentType: true,
                scormPackageUrl: true,
                scormEntryPoint: true,
                scormVersion: true,
                course: { select: { id: true, tenantId: true, createdById: true, isActive: true } },
            },
        });
        if (!lesson) throw new NotFoundError('Lesson not found');
        if (user) assertCanManageCourse(lesson.course, user, 'update lessons in');
        const newType = data.contentType ?? lesson.contentType;
        if (['SCORM', 'SCORM_12'].includes(newType)) {
            if (data.scormPackageUrl === null || data.scormPackageUrl === '') {
                throw new BadRequestError('scormPackageUrl cannot be empty for SCORM lessons');
            }
        }

        const scormPackageCandidate = data.scormPackageUrl ?? lesson.scormPackageUrl;
        const shouldPrepareScorm = ['SCORM', 'SCORM_12'].includes(newType)
            && scormPackageCandidate
            && (
                data.scormPackageUrl
                || looksLikeScormZipUrl(scormPackageCandidate)
            );

        if (shouldPrepareScorm) {
            try {
                const prepared = await ensureScormPackagePrepared(
                    scormPackageCandidate,
                    data.scormEntryPoint ?? lesson.scormEntryPoint,
                    data.scormVersion ?? lesson.scormVersion ?? '1.2',
                );
                data.scormPackageUrl = prepared.scormPackageUrl;
                if (!data.scormEntryPoint) {
                    data.scormEntryPoint = prepared.scormEntryPoint;
                }
            } catch (error) {
                throw new BadRequestError(error.message || 'Failed to prepare SCORM package');
            }
        }

        if (['SCORM', 'SCORM_12'].includes(newType)) {
            const finalPackageUrl = data.scormPackageUrl ?? lesson.scormPackageUrl;
            if (looksLikeScormZipUrl(finalPackageUrl)) {
                throw new BadRequestError(
                    'SCORM package is still stored as .zip. Re-upload the package or fix server extraction.',
                );
            }
        }

        const nonScormTypes = ['PDF', 'WORD', 'EXCEL', 'VIDEO_UPLOAD', 'FILE'];
        if (nonScormTypes.includes(newType) && data.contentUrl === null) {
            throw new Error('contentUrl cannot be empty for this lesson type');
        }
        const updateData = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;
        if (data.contentType !== undefined) updateData.contentType = data.contentType;
        if (data.scormPackageUrl !== undefined) updateData.scormPackageUrl = data.scormPackageUrl;
        if (data.scormVersion !== undefined) updateData.scormVersion = data.scormVersion;
        if (data.scormEntryPoint !== undefined) updateData.scormEntryPoint = data.scormEntryPoint;
        if (data.contentUrl !== undefined) updateData.contentUrl = data.contentUrl;
        if (data.youtubeUrl !== undefined) updateData.youtubeUrl = data.youtubeUrl;
        if (data.durationSecs !== undefined) updateData.durationSecs = data.durationSecs;
        if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
        if (data.isLocked !== undefined) updateData.isLocked = data.isLocked;

        return prisma.lesson.update({
            where: { id },
            data: updateData,
            include: {
                _count: { select: { progress: true } },
            },
        });
    }


    async deleteLesson(id, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id },
            select: {
                id: true,
                course: { select: { id: true, tenantId: true, createdById: true, isActive: true } },
                _count: { select: { progress: true, scormSessions: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) assertCanManageCourse(lesson.course, user, 'delete lessons from');

        if (lesson._count.progress > 0 || lesson._count.scormSessions > 0) {
            throw new Error(
                `Cannot delete lesson with ${lesson._count.progress} progress record(s) and ` +
                `${lesson._count.scormSessions} SCORM session(s). Deactivate it instead.`
            );
        }

        return prisma.lesson.delete({ where: { id } });
    }

    async reorderLessons(courseId, lessonOrders, user = null) {
        try {
            const course = await prisma.course.findUnique({
                where: { id: courseId },
                select: {
                    id: true,
                    tenantId: true,
                    createdById: true,
                    isActive: true
                },
            });

            if (!course) {
                throw new Error('Course not found');
            }


            if (user) {
                assertCanManageCourse(course, user, 'reorder lessons in');
            }


            const lessonIds = lessonOrders.map(l => l.id);

            const dbLessons = await prisma.lesson.findMany({
                where: {
                    id: { in: lessonIds },
                    courseId: courseId
                },
                select: {
                    id: true,
                    title: true
                },
            });

            if (dbLessons.length !== lessonIds.length) {
                const foundIds = dbLessons.map(l => l.id);
                const missingIds = lessonIds.filter(id => !foundIds.includes(id));
                throw new Error(`One or more lessons do not belong to this course: ${missingIds.join(', ')}`);
            }

            const updatePromises = lessonOrders.map(({ id, orderIndex }) =>
                prisma.lesson.update({
                    where: { id },
                    data: { orderIndex }
                })
            );

            await prisma.$transaction(updatePromises);

            const updatedLessons = await prisma.lesson.findMany({
                where: { courseId },
                orderBy: { orderIndex: 'asc' },
                include: {
                    _count: {
                        select: { progress: true }
                    }
                }
            });

            console.log(' Reorder completed. Total lessons:', updatedLessons.length);

            return updatedLessons;

        } catch (error) {
            console.error(' Reorder error:', error);
            throw error;
        }
    }




    async trackProgress(lessonId, userId, progressData, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                courseId: true,
                contentType: true,
                isRequired: true,
                isLocked: true,
                orderIndex: true,
                durationSecs: true,
                course: {
                    select: {
                        id: true,
                        tenantId: true,
                        createdById: true,
                        isActive: true,
                        navigationMode: true,
                    },
                },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) await assertCanAccessCourse(lesson.course, user, prisma);

        if (this._isScorm(lesson.contentType)) {
            throw new Error(
                'SCORM lesson progress is managed automatically by the SCORM player. ' +
                'Use the /scorm/launch → /scorm/finish flow instead.'
            );
        }

        if (
            lesson.isLocked
            && ['FREE', 'LOCKED_FINAL'].includes(lesson.course.navigationMode)
        ) {
            throw new Error('This lesson is locked');
        }

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: lesson.courseId } },
            select: { id: true, status: true, expiresAt: true },
        });

        if (!enrollment) throw new Error('You are not enrolled in this course');
        if (['EXPIRED', 'SUSPENDED'].includes(enrollment.status)) {
            throw new Error('Your enrollment is expired or suspended');
        }
        if (enrollment.status === 'COMPLETED') throw new Error('Course already completed');
        if (enrollment.expiresAt < new Date()) throw new Error('Course access has expired');

        const [allLessons, allProgress] = await Promise.all([
            prisma.lesson.findMany({
                where: { courseId: lesson.courseId },
                orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    contentType: true,
                    isRequired: true,
                    isLocked: true,
                    orderIndex: true,
                    durationSecs: true,
                },
            }),
            prisma.lessonProgress.findMany({
                where: { enrollmentId: enrollment.id },
                select: {
                    lessonId: true,
                    completed: true,
                    scormStatus: true,
                    watchPercent: true,
                    timeSpentSecs: true,
                },
            }),
        ]);
        const progressMap = new Map(allProgress.map(p => [p.lessonId, p]));
        const accessProgressMap = this._buildAccessProgressMap(allLessons, progressMap);

        const existingProgress = await prisma.lessonProgress.findUnique({
            where: {
                enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId },
            },
            select: {
                timeSpentSecs: true,
                watchPercent: true,
                lastPositionSecs: true,
                completed: true,
                completedAt: true,
                startedAt: true,
            },
        });

        const hasExistingProgress = Boolean(existingProgress);
        const canAccessLesson = this._isLessonAccessible(
            lesson,
            allLessons,
            accessProgressMap,
            lesson.course.navigationMode,
        );

        if (!hasExistingProgress && !canAccessLesson) {
            const blockingLesson = allLessons.find((courseLesson, index) => {
                const lessonIndex = allLessons.findIndex((item) => item.id === lesson.id);
                if (lessonIndex < 0 || index >= lessonIndex) return false;
                if (!courseLesson.isRequired) return false;
                const prevProgress = accessProgressMap.get(courseLesson.id);
                return !this._isLessonCompleted(courseLesson, prevProgress);
            });

            const message = blockingLesson
                ? `Complete lesson ${blockingLesson.orderIndex + 1} before accessing this one`
                : 'Complete previous required lessons before accessing this one';
            throw new BadRequestError(message);
        }

        const requestedCompleted = progressData.completed ?? false;
        const requestedTimeSpent = progressData.timeSpentSecs ?? 0;
        const requestedWatchPercent = progressData.watchPercent ?? undefined;
        const requestedLastPosition = progressData.lastPositionSecs ?? undefined;

        const watchPercent = Math.max(
            existingProgress?.watchPercent ?? 0,
            requestedWatchPercent ?? 0,
        );
        const lastPositionSecs = requestedLastPosition != null
            ? Math.max(existingProgress?.lastPositionSecs ?? 0, requestedLastPosition)
            : (existingProgress?.lastPositionSecs ?? 0);

        const durationSecs = lesson.durationSecs ?? null;
        const timeSpentSecs = Math.max(
            existingProgress?.timeSpentSecs ?? 0,
            requestedTimeSpent,
            lastPositionSecs,
            durationSecs && watchPercent >= MIN_WATCH_PERCENT
                ? Math.ceil(durationSecs * (watchPercent / 100))
                : 0,
        );

        const effectiveMinSecs = durationSecs && durationSecs > 0
            ? durationSecs
            : (DOCUMENT_TYPES.includes(lesson.contentType) ? DEFAULT_MIN_READ_SECS : null);
        const meetsWatchThreshold = watchPercent >= MIN_WATCH_PERCENT
            || (effectiveMinSecs != null && timeSpentSecs >= Math.ceil(effectiveMinSecs * (MIN_WATCH_PERCENT / 100)));

        const isCompleted = requestedCompleted
            || (existingProgress?.completed ?? false)
            || meetsWatchThreshold;

        const progress = await prisma.lessonProgress.upsert({
            where: {
                enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId },
            },
            create: {
                enrollmentId: enrollment.id,
                lessonId,
                completed: isCompleted,
                completedAt: isCompleted ? new Date() : null,
                timeSpentSecs,
                watchPercent,
                lastPositionSecs,
                startedAt: new Date(),
            },
            update: {
                completed: isCompleted,
                completedAt: isCompleted && !existingProgress?.completed
                    ? new Date()
                    : existingProgress?.completedAt,
                timeSpentSecs,
                watchPercent,
                lastPositionSecs,
                startedAt: existingProgress?.startedAt ?? new Date(),
            },
        });

        await enrollmentService.checkAndUpdateEnrollmentStatus(enrollment.id);

        return progress;
    }

    async checkCourseCompletion(_courseId, enrollmentId) {
        await enrollmentService.checkAndUpdateEnrollmentStatus(enrollmentId);
    }

    async getUserProgress(courseId, userId, user = null, locale = 'it') {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: {
                id: true,
                courseTitle: true,
                slug: true,
                tenantId: true,
                createdById: true,
                isActive: true,
                navigationMode: true,
            },
        });
        if (!course) throw new NotFoundError('Course not found');
        if (user) await assertCanAccessCourse(course, user, prisma);

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, status: true, startedAt: true, completedAt: true, expiresAt: true },
        });
        if (!enrollment) throw new Error('You are not enrolled in this course');

        const lessons = await prisma.lesson.findMany({
            where: { courseId },
            orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
            include: {
                progress: {
                    where: { enrollmentId: enrollment.id },
                    select: {
                        timeSpentSecs: true,
                        watchPercent: true,
                        lastPositionSecs: true,
                        completed: true,
                        completedAt: true,
                        startedAt: true,
                        scormStatus: true,
                        scormScore: true,
                        scormPassed: true,
                    },
                },
            },
        });

        const progressMap = new Map(
            lessons.map(l => [l.id, l.progress[0] || null])
        );

        const rows = lessons.map(lesson =>
            this._formatLessonProgressRow(lesson, progressMap.get(lesson.id), locale, {
                sortedLessons: lessons,
                progressMap,
                navigationMode: course.navigationMode,
            })
        );

        const totalLessons = rows.length;
        const completedLessons = rows.filter(r => r.isCompleted).length;
        const requiredLessons = rows.filter(r => r.isRequired);
        const completedRequired = requiredLessons.filter(r => r.isCompleted).length;

        let certificate = await prisma.certificate.findUnique({
            where: { enrollmentId: enrollment.id },
            select: {
                id: true,
                status: true,
                pdfUrl: true,
                issuedAt: true,
                downloadableUntil: true,
            },
        });

        if (enrollment.status === 'COMPLETED' && !certificate) {
            certificate = await certificateService.autoGenerateOnCompletion(enrollment.id);
        }

        return {
            enrollment: {
                id: enrollment.id,
                status: enrollment.status,
                startedAt: enrollment.startedAt,
                completedAt: enrollment.completedAt,
                expiresAt: enrollment.expiresAt,
            },
            certificate: certificate
                ? {
                    id: certificate.id,
                    status: certificate.status,
                    pdfUrl: certificate.pdfUrl ?? null,
                    issuedAt: certificate.issuedAt ?? null,
                    downloadableUntil: certificate.downloadableUntil ?? null,
                }
                : null,
            course: {
                id: course.id,
                title: t(course.courseTitle, locale),
                slug: course.slug,
                navigationMode: course.navigationMode,
            },
            summary: {
                totalLessons,
                completedLessons,
                requiredLessons: requiredLessons.length,
                completedRequiredLessons: completedRequired,
                percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                totalTimeSpentSecs: rows.reduce(
                    (s, r) => s + Math.max(r.timeSpentSecs ?? 0, r.lastPositionSecs ?? 0),
                    0,
                ),
            },
            lessons: rows,
        };
    }



    async getMyAllProgress(userId, locale = 'it', queryParams = {}) {
        const enrollments = await prisma.enrollment.findMany({
            where: { userId },
            include: {
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                        slug: true,
                        tenantId: true,
                        isActive: true,
                    },
                },
                lessonProgress: {
                    include: {
                        lesson: {
                            select: {
                                id: true,
                                title: true,
                                contentType: true,
                                orderIndex: true,
                                isRequired: true,
                            },
                        },
                    },
                    orderBy: { lesson: { orderIndex: 'asc' } },
                },
            },
        });

        return enrollments.map(enrollment => ({
            courseId: enrollment.courseId,
            courseTitle: t(enrollment.course.courseTitle, locale),
            courseSlug: enrollment.course.slug,
            enrollmentStatus: enrollment.status,
            startedAt: enrollment.startedAt,
            completedAt: enrollment.completedAt,
            lessons: enrollment.lessonProgress.map(p => {
                const isScorm = this._isScorm(p.lesson.contentType);
                const isCompleted = this._isLessonCompleted(p.lesson, p);

                return {
                    lessonId: p.lessonId,
                    lessonTitle: t(p.lesson.title, locale),
                    contentType: p.lesson.contentType,
                    isTracked: isScorm,
                    isRequired: p.lesson.isRequired,
                    isCompleted,
                    timeSpentSecs: p.timeSpentSecs,
                    completedAt: p.completedAt,
                    scormStatus: isScorm ? p.scormStatus : null,
                    scormScore: isScorm ? p.scormScore : null,
                    scormPassed: isScorm ? p.scormPassed : null,
                };
            }),
        }));
    }

    async getLessonByIdStandalone(id, locale = 'it', includeProgress = false, userId = null, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id },
            include: {
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                        tenantId: true,
                        createdById: true,
                        isActive: true,
                        slug: true,
                    },
                },
                _count: {
                    select: { progress: true }
                },
                ...(includeProgress && userId && {
                    progress: {
                        where: { enrollment: { userId } },
                        select: {
                            timeSpentSecs: true,
                            completed: true,
                            completedAt: true,
                            startedAt: true,
                            scormStatus: true,
                            scormScore: true,
                            scormPassed: true,
                        },
                    },
                }),
            },
        });

        if (!lesson) return null;
        if (user) await assertCanAccessCourse(lesson.course, user, prisma);

        const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);

        // ✅ Extract data properly
        const { course, _count, progress, ...lessonScalars } = lesson;

        // ✅ FIX: Localize the lesson
        const localizedLesson = localizeObject(lessonScalars, locale, LESSON_I18N_KEYS);

        // ✅ FIX: Localize course title separately
        const localizedCourseTitle = t(course.courseTitle, locale);

        return {
            ...localizedLesson,
            viewCount: _count.progress,
            isTracked: isScorm,
            userProgress: progress?.[0] || null,
            course: {
                id: course.id,
                title: localizedCourseTitle,
                slug: course.slug,
                isActive: course.isActive,
            },
        };
    }



    async getLessonStats(lessonId, user = null, locale = 'it') {
        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                title: true,
                courseId: true,
                contentType: true,
                course: { select: { id: true, tenantId: true, createdById: true, isActive: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) assertCanManageCourse(lesson.course, user, 'view statistics for');

        const isScorm = this._isScorm(lesson.contentType);
        const lessonTitle = t(lesson.title, locale);

        if (isScorm) {
            const [totalViewers, completedCount, timeStats, scormStats] = await Promise.all([
                prisma.lessonProgress.count({ where: { lessonId } }),
                prisma.lessonProgress.count({
                    where: { lessonId, scormStatus: { in: ['COMPLETED', 'PASSED'] } },
                }),
                prisma.lessonProgress.aggregate({
                    where: { lessonId },
                    _avg: { timeSpentSecs: true },
                    _sum: { timeSpentSecs: true },
                    _max: { timeSpentSecs: true },
                }),
                prisma.lessonProgress.aggregate({
                    where: { lessonId, scormStatus: { in: ['COMPLETED', 'PASSED'] } },
                    _count: { _all: true },
                    _avg: { scormScore: true },
                }),
            ]);
            const statusBreakdown = await prisma.lessonProgress.groupBy({
                by: ['scormStatus'],
                where: { lessonId },
                _count: { _all: true },
            });

            return {
                lessonId,
                lessonTitle,
                contentType: lesson.contentType,
                isScorm: true,
                totalViewers,
                completedCount,
                completionRate: totalViewers > 0 ? Math.round((completedCount / totalViewers) * 100) : 0,
                averageTimeSpentSecs: Math.round(timeStats._avg.timeSpentSecs ?? 0),
                totalTimeSpentSecs: timeStats._sum.timeSpentSecs ?? 0,
                maxTimeSpentSecs: timeStats._max.timeSpentSecs ?? 0,
                averageScormScore: Math.round(scormStats._avg.scormScore ?? 0),
                statusBreakdown: statusBreakdown.reduce((acc, r) => {
                    acc[r.scormStatus ?? 'UNKNOWN'] = r._count._all;
                    return acc;
                }, {}),
            };
        }
        const totalViewers = await prisma.lessonProgress.count({ where: { lessonId } });

        return {
            lessonId,
            lessonTitle,
            contentType: lesson.contentType,
            isScorm: false,
            totalViewers,
            note: 'Non-SCORM lessons are not tracked. Only access count is available.',
        };
    }

    async getLessonStatus(lessonId, userId, locale = 'it') {
        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                title: true,
                contentType: true,
                isRequired: true,
                isLocked: true,
                orderIndex: true,
                courseId: true,
                course: {
                    select: {
                        id: true,
                        navigationMode: true,
                        tenantId: true,
                        createdById: true,
                        isActive: true,
                    },
                },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (!lesson.course.isActive) throw new Error('Course is not active');

        const isScorm = this._isScorm(lesson.contentType);
        const lessonTitle = t(lesson.title, locale);

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: lesson.courseId } },
            select: { id: true, status: true, expiresAt: true },
        });

        if (!enrollment) {
            return {
                lessonId: lesson.id,
                lessonTitle,
                isEnrolled: false,
                isLocked: lesson.isLocked,
                isAccessible: false,
                isRequired: lesson.isRequired,
                contentType: lesson.contentType,
                isTracked: isScorm,
                status: 'NOT_ENROLLED',
            };
        }

        const allLessons = await prisma.lesson.findMany({
            where: { courseId: lesson.courseId },
            orderBy: { orderIndex: 'asc' },
            select: { id: true, contentType: true, isRequired: true, isLocked: true, orderIndex: true },
        });

        const allProgress = await prisma.lessonProgress.findMany({
            where: { enrollmentId: enrollment.id },
            select: {
                lessonId: true,
                completed: true,
                completedAt: true,
                startedAt: true,
                scormStatus: true,
                scormScore: true,
                scormPassed: true,
                timeSpentSecs: true,
                watchPercent: true,
            },
        });
        const progressMap = new Map(allProgress.map(p => [p.lessonId, p]));
        const progress = progressMap.get(lesson.id) || null;

        const isCompleted = this._isLessonCompleted(lesson, progress);
        const isAccessible = this._isLessonAccessible(
            lesson,
            allLessons,
            progressMap,
            lesson.course.navigationMode
        );

        return {
            lessonId: lesson.id,
            lessonTitle,
            isEnrolled: true,
            enrollmentStatus: enrollment.status,
            expiresAt: enrollment.expiresAt,
            navigationMode: lesson.course.navigationMode,
            isLocked: lesson.isLocked,
            isAccessible,
            isRequired: lesson.isRequired,
            contentType: lesson.contentType,
            isTracked: isScorm,
            isCompleted,
            timeSpentSecs: progress?.timeSpentSecs ?? 0,
            startedAt: progress?.startedAt ?? null,
            completedAt: progress?.completedAt ?? null,
            scormStatus: isScorm ? (progress?.scormStatus ?? 'NOT_ATTEMPTED') : null,
            scormScore: isScorm ? (progress?.scormScore ?? null) : null,
            scormPassed: isScorm ? (progress?.scormPassed ?? false) : null,
        };
    }
}

export const lessonService = new LessonService();