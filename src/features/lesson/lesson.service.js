
import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';

const LESSON_I18N_KEYS = ['title'];
export class LessonService {

    async getLessonsByCourse(courseId, locale = 'it', queryParams = {}, user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, courseTitle: true, tenantId: true, isActive: true },
        });
        if (!course) throw new Error('Course not found');

        if (user) await this._checkCoursePermission(course, user);

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
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            lessons: lessons.map(lesson => ({
                ...localizeObject(lesson, locale, LESSON_I18N_KEYS),
                viewCount: lesson._count.progress,
                isTracked: ['SCORM', 'SCORM_12'].includes(lesson.contentType),
            })),
        };
    }

    async getLessonById(id, locale = 'it', includeProgress = false, userId = null, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id },
            include: {
                course: { select: { tenantId: true, isActive: true } },
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
        if (user) await this._checkCoursePermission(lesson.course, user);

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
        if (!course) throw new Error('Course not found');
        if (user) await this._checkCoursePermission(course, user);

        if (['SCORM', 'SCORM_12'].includes(data.contentType)) {
            if (!data.scormPackageUrl) throw new Error('scormPackageUrl is required for SCORM lessons');
            if (!data.scormEntryPoint) throw new Error('scormEntryPoint is required for SCORM lessons (e.g., "index_lms.html")');
        }

        const nonScormTypes = ['PDF', 'WORD', 'EXCEL', 'VIDEO_UPLOAD', 'FILE'];
        if (nonScormTypes.includes(data.contentType) && !data.contentUrl) {
            throw new Error('contentUrl is required for this lesson type');
        }
        if (data.contentType === 'VIDEO_YOUTUBE' && !data.youtubeUrl) {
            throw new Error('youtubeUrl is required for VIDEO_YOUTUBE lessons');
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
                course: { select: { tenantId: true, createdById: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) await this._checkCoursePermission(lesson.course, user);
        const newType = data.contentType ?? lesson.contentType;
        if (['SCORM', 'SCORM_12'].includes(newType)) {
            if (data.scormPackageUrl === null || data.scormPackageUrl === '') {
                throw new Error('scormPackageUrl cannot be empty for SCORM lessons');
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
                course: { select: { tenantId: true, createdById: true } },
                _count: { select: { progress: true, scormSessions: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) await this._checkCoursePermission(lesson.course, user);

        if (lesson._count.progress > 0 || lesson._count.scormSessions > 0) {
            throw new Error(
                `Cannot delete lesson with ${lesson._count.progress} progress record(s) and ` +
                `${lesson._count.scormSessions} SCORM session(s). Deactivate it instead.`
            );
        }

        return prisma.lesson.delete({ where: { id } });
    }

    async reorderLessons(courseId, lessonOrders, user = null) {
        // 1. Check if course exists
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, tenantId: true, createdById: true },
        });
        if (!course) throw new Error('Course not found');

        // 2. Check permission
        if (user) await this._checkCoursePermission(course, user);

        // 3. Get all lesson IDs from request
        const lessonIds = lessonOrders.map(l => l.id);

        // 4. Verify all lessons belong to this course
        const dbLessons = await prisma.lesson.findMany({
            where: { id: { in: lessonIds }, courseId },
            select: { id: true },
        });

        // 5. If any lesson doesn't belong, throw error
        if (dbLessons.length !== lessonIds.length) {
            throw new Error('One or more lessons do not belong to this course');
        }

        // 6. Update each lesson's orderIndex in a transaction
        await prisma.$transaction(
            lessonOrders.map(({ id, orderIndex }) =>
                prisma.lesson.update({
                    where: { id },
                    data: { orderIndex }
                })
            )
        );

        // 7. Return updated lessons
        return prisma.lesson.findMany({
            where: { courseId },
            orderBy: { orderIndex: 'asc' },
        });
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
                await this._checkCoursePermission(course, user);
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
                course: { select: { id: true, tenantId: true, isActive: true } }, // ✅ add id + isActive
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) await this._checkCoursePermission(lesson.course, user);

        const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);
        if (isScorm) {
            throw new Error(
                'SCORM lesson progress is managed automatically by the SCORM player. ' +
                'Use the /scorm/launch → /scorm/finish flow instead.'
            );
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
        const isCompleted = progressData.completed ?? false;
        const timeSpentSecs = progressData.timeSpentSecs ?? 0;

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
                startedAt: new Date(),
            },
            update: {
                completed: isCompleted,
                completedAt: isCompleted ? new Date() : undefined,
                timeSpentSecs,
            },
        });

        if (isCompleted) {
            await this.checkCourseCompletion(lesson.courseId, enrollment.id);
        }

        return progress;
    }


    async checkCourseCompletion(courseId, enrollmentId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { status: true },
        });
        if (!enrollment || enrollment.status === 'COMPLETED') return;

        const requiredLessons = await prisma.lesson.findMany({
            where: { courseId, isRequired: true },
            select: { id: true, contentType: true },
        });
        if (requiredLessons.length === 0) return;

        const progressRecords = await prisma.lessonProgress.findMany({
            where: {
                enrollmentId,
                lessonId: { in: requiredLessons.map(l => l.id) },
            },
            select: { lessonId: true, completed: true, scormStatus: true },
        });

        const progressMap = new Map(progressRecords.map(p => [p.lessonId, p]));

        const allDone = requiredLessons.every(lesson => {
            const p = progressMap.get(lesson.id);
            if (!p) return false;
            if (['SCORM', 'SCORM_12'].includes(lesson.contentType)) {
                return ['COMPLETED', 'PASSED'].includes(p.scormStatus);
            }
            return p.completed === true;
        });

        if (allDone) {
            await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
        }
    }

    async getUserProgress(courseId, userId, user = null) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, tenantId: true, isActive: true },
        });
        if (!course) throw new Error('Course not found');
        if (user) await this._checkCoursePermission(course, user);

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true },
        });
        if (!enrollment) throw new Error('User is not enrolled in this course');

        const lessons = await prisma.lesson.findMany({
            where: { courseId },
            orderBy: { orderIndex: 'asc' },
            include: {
                progress: {
                    where: { enrollmentId: enrollment.id },
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
            },
        });

        return lessons.map(lesson => {
            const p = lesson.progress[0] || null;
            const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);
            const isCompleted = isScorm
                ? ['COMPLETED', 'PASSED'].includes(p?.scormStatus)
                : (p?.completed ?? false);

            return {
                lessonId: lesson.id,
                title: lesson.title,
                orderIndex: lesson.orderIndex,
                contentType: lesson.contentType,
                isTracked: isScorm,
                isRequired: lesson.isRequired,
                isLocked: lesson.isLocked,
                isCompleted,
                timeSpentSecs: p?.timeSpentSecs ?? 0,
                startedAt: p?.startedAt ?? null,
                completedAt: p?.completedAt ?? null,
                scormStatus: isScorm ? (p?.scormStatus ?? 'NOT_ATTEMPTED') : null,
                scormScore: isScorm ? (p?.scormScore ?? null) : null,
                scormPassed: isScorm ? (p?.scormPassed ?? false) : null,
            };
        });
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
            courseTitle: localizeObject(enrollment.course.courseTitle, locale),
            courseSlug: enrollment.course.slug,
            enrollmentStatus: enrollment.status,
            startedAt: enrollment.startedAt,
            completedAt: enrollment.completedAt,
            lessons: enrollment.lessonProgress.map(p => {
                const isScorm = ['SCORM', 'SCORM_12'].includes(p.lesson.contentType);
                const isCompleted = isScorm
                    ? ['COMPLETED', 'PASSED'].includes(p.scormStatus)
                    : p.completed;

                return {
                    lessonId: p.lessonId,
                    lessonTitle: localizeObject(p.lesson.title, locale),
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
                        isActive: true,
                        slug: true
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
        if (user) await this._checkCoursePermission(lesson.course, user);

        const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);

        // ✅ Extract data properly
        const { course, _count, progress, ...lessonScalars } = lesson;

        // ✅ FIX: Localize the lesson
        const localizedLesson = localizeObject(lessonScalars, locale, LESSON_I18N_KEYS);

        // ✅ FIX: Localize course title separately
        const localizedCourseTitle = localizeObject(course.courseTitle, locale);

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



    async getLessonStats(lessonId, user = null) {
        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                title: true,
                courseId: true,
                contentType: true,
                course: { select: { tenantId: true, createdById: true, isActive: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (user) await this._checkCoursePermission(lesson.course, user);

        const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);

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
                lessonTitle: lesson.title,
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
            lessonTitle: lesson.title,
            contentType: lesson.contentType,
            isScorm: false,
            totalViewers,
            note: 'Non-SCORM lessons are not tracked. Only access count is available.',
        };
    }

    async getLessonStatus(lessonId, userId) {
        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                title: true,
                contentType: true,
                isRequired: true,
                isLocked: true,
                courseId: true,
                course: { select: { tenantId: true, isActive: true } },
            },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (!lesson.course.isActive) throw new Error('Course is not active');

        const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: lesson.courseId } },
            select: { id: true, status: true, expiresAt: true },
        });

        if (!enrollment) {
            return {
                lessonId: lesson.id,
                lessonTitle: lesson.title,
                isEnrolled: false,
                isLocked: lesson.isLocked,
                isRequired: lesson.isRequired,
                contentType: lesson.contentType,
                isTracked: isScorm,
                status: 'NOT_ENROLLED',
            };
        }

        const progress = await prisma.lessonProgress.findUnique({
            where: {
                enrollmentId_lessonId: {
                    enrollmentId: enrollment.id,
                    lessonId: lesson.id,
                },
            },
            select: {
                completed: true,
                completedAt: true,
                startedAt: true,
                scormStatus: true,
                scormScore: true,
                scormPassed: true,
                timeSpentSecs: true,
            },
        });

        const isCompleted = isScorm
            ? ['COMPLETED', 'PASSED'].includes(progress?.scormStatus)
            : (progress?.completed ?? false);

        return {
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            isEnrolled: true,
            enrollmentStatus: enrollment.status,
            expiresAt: enrollment.expiresAt,
            isLocked: lesson.isLocked,
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


    async _checkCoursePermission(course, user) {
        if (!user) return;

        const { level: userLevel, id: userId } = user;

        if (userLevel === 'PLATFORM_ADMIN') return;

        if (userLevel === 'LICENSEE') {
            const dbUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { tenantId: true },
            });
            if (course.tenantId !== dbUser?.tenantId) {
                throw new Error('Permission denied: This course belongs to a different tenant');
            }
            return;
        }

        if (userLevel === 'TEACHER') {
            const teacherCourse = await prisma.course.findFirst({
                where: {
                    id: course.id,
                    OR: [{ createdById: userId }, { teacherId: userId }],
                },
                select: { id: true },
            });
            if (!teacherCourse) {
                throw new Error('Permission denied: You are not the teacher of this course');
            }
            return;
        }
        if (!course.isActive) throw new Error('This course is not active');
    }
}

export const lessonService = new LessonService();