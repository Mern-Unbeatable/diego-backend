
import { prisma } from '../../config/db.js';
import { randomBytes } from 'crypto';
import { addDays } from 'date-fns';
import { config } from '../../config/config.js';
import { certificateService } from '../certificate/certificate.service.js';
import { credentialDeliveryService } from '../credential/credentialDelivery.service.js';
import { computeRetentionUntil } from '../../shared/services/retention.service.js';
import {
    LICENSEE_COURSE_SELECT,
    formatLicenseeCourse,
    formatLicenseeLesson,
    formatLicenseeQuiz,
    formatStudentUser,
    uniqueStudentIdsOrdered,
    pickLocalizedTitle,
} from './enrollment.utils.js';

const effectiveLessonTimeSecs = (record) =>
    Math.max(record?.timeSpentSecs ?? 0, record?.lastPositionSecs ?? 0);

class EnrollmentService {

    async _resolveTenantId(user) {
        if (!user) return null;
        if (user.tenantId) return user.tenantId;
        if (user.id) {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { tenantId: true },
            });
            return dbUser?.tenantId ?? null;
        }
        return null;
    }

    async _getLicenseeContext(user, queryParams = {}) {
        if (!user || !['PLATFORM_ADMIN', 'LICENSE_USER'].includes(user.level)) {
            throw new Error('Only license users and platform admins can access this endpoint');
        }

        let tenantId = null;
        if (user.level === 'LICENSE_USER') {
            tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('License user must have a tenant assigned');
        } else if (queryParams.tenantId) {
            tenantId = queryParams.tenantId;
        }

        return { tenantId };
    }

    async _getLicenseeCourseIds(user, queryParams = {}) {
        const { tenantId } = await this._getLicenseeContext(user, queryParams);
        const courseWhere = {};
        if (tenantId) courseWhere.tenantId = tenantId;
        if (user?.level === 'LICENSE_USER' || user?.level === 'PLATFORM_ADMIN') {
            courseWhere.createdById = user.id;
        }
        if (queryParams.courseId) courseWhere.id = queryParams.courseId;

        const courses = await prisma.course.findMany({
            where: courseWhere,
            select: { id: true },
        });
        return courses.map(c => c.id);
    }

    async _computeEnrollmentProgress(enrollmentId, courseId) {
        const lessons = await prisma.lesson.findMany({
            where: { courseId },
            select: { id: true, contentType: true },
        });

        if (lessons.length === 0) {
            return { totalLessons: 0, completedLessons: 0, percentage: 0 };
        }

        const progressRecords = await prisma.lessonProgress.findMany({
            where: { enrollmentId, lessonId: { in: lessons.map(l => l.id) } },
            select: {
                lessonId: true,
                completed: true,
                scormStatus: true,
                timeSpentSecs: true,
                lastPositionSecs: true,
            },
        });
        const progressMap = new Map(progressRecords.map(p => [p.lessonId, p]));

        const completedLessons = lessons.filter(lesson => {
            const p = progressMap.get(lesson.id);
            if (!p) return false;
            if (['SCORM', 'SCORM_12'].includes(lesson.contentType)) {
                return ['COMPLETED', 'PASSED'].includes(p.scormStatus);
            }
            return p.completed === true;
        }).length;

        const totalTimeSpentSecs = progressRecords.reduce(
            (sum, p) => sum + effectiveLessonTimeSecs(p),
            0,
        );

        return {
            totalLessons: lessons.length,
            completedLessons,
            percentage: Math.round((completedLessons / lessons.length) * 100),
            totalTimeSpentSecs,
        };
    }

    async getLicenseeOverview(queryParams = {}, user = null, locale = 'it') {
        const { tenantId } = await this._getLicenseeContext(user, queryParams);
        const courseIds = await this._getLicenseeCourseIds(user, queryParams);

        if (courseIds.length === 0) {
            return {
                tenantId,
                stats: {
                    totalCourses: 0,
                    totalStudents: 0,
                    totalEnrollments: 0,
                    activeStudents: 0,
                    completedStudents: 0,
                    certificatesIssued: 0,
                },
                courseBreakdown: [],
            };
        }

        const enrollmentWhere = { courseId: { in: courseIds } };

        const [
            totalCourses,
            totalEnrollments,
            uniqueStudents,
            activeStudentRows,
            completedStudentRows,
            certificatesIssued,
            courseBreakdown,
            statusBreakdown,
        ] = await Promise.all([
            prisma.course.count({ where: { id: { in: courseIds } } }),
            prisma.enrollment.count({ where: enrollmentWhere }),
            prisma.enrollment.findMany({
                where: enrollmentWhere,
                select: { userId: true },
                distinct: ['userId'],
            }),
            prisma.enrollment.findMany({
                where: { ...enrollmentWhere, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
                select: { userId: true },
                distinct: ['userId'],
            }),
            prisma.enrollment.findMany({
                where: { ...enrollmentWhere, status: 'COMPLETED' },
                select: { userId: true },
                distinct: ['userId'],
            }),
            prisma.certificate.count({
                where: { courseId: { in: courseIds }, status: 'ISSUED' },
            }),
            prisma.course.findMany({
                where: { id: { in: courseIds } },
                select: {
                    id: true,
                    slug: true,
                    courseTitle: true,
                    isActive: true,
                    _count: { select: { enrollments: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
            }),
            prisma.enrollment.groupBy({
                by: ['status'],
                where: enrollmentWhere,
                _count: { _all: true },
            }),
        ]);

        return {
            tenantId,
            stats: {
                totalCourses,
                totalStudents: uniqueStudents.length,
                totalEnrollments,
                activeStudents: activeStudentRows.length,
                completedStudents: completedStudentRows.length,
                certificatesIssued,
                statusBreakdown: statusBreakdown.reduce((acc, item) => {
                    acc[item.status] = item._count._all;
                    return acc;
                }, {}),
            },
            courseBreakdown: courseBreakdown.map(course => ({
                id: course.id,
                slug: course.slug,
                courseTitle: pickLocalizedTitle(course.courseTitle, locale),
                isActive: course.isActive,
                totalEnrollments: course._count.enrollments,
            })),
        };
    }



    async createEnrollment(data, user = null) {
        const { courseId, userId, packagePurchaseId, companyContextId, expiresAt, assignedEmail } = data;

        const course = await this.validateCourseAccess(courseId, user);
        if (!course) throw new Error('Course not found');
        if (!course.isActive) throw new Error('Course is not active');

        if (userId) await this.validateUserAccess(userId, user);
        if (packagePurchaseId) await this.validatePackagePurchase(packagePurchaseId);

        if (userId) {
            const existing = await prisma.enrollment.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true, status: true },
            });
            if (existing) {
                if (existing.status === 'COMPLETED') throw new Error('User has already completed this course');
                throw new Error('User is already enrolled in this course');
            }
        }

        const calculatedExpiresAt = expiresAt || addDays(new Date(), course.validityDays || 90);

        const enrollment = await prisma.$transaction(async tx => {
            const newEnrollment = await tx.enrollment.create({
                data: {
                    courseId,
                    userId,
                    packagePurchaseId,
                    companyContextId,
                    expiresAt: calculatedExpiresAt,
                    assignedEmail,
                    status: 'NOT_STARTED',
                },
                include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                    course: { select: { id: true, slug: true, courseTitle: true, tenantId: true } },
                },
            });

            if (packagePurchaseId) {
                await tx.packagePurchase.update({
                    where: { id: packagePurchaseId },
                    data: { seatsUsed: { increment: 1 } },
                });
            }

            return newEnrollment;
        });

        if (userId && enrollment.user) {
            await credentialDeliveryService.recordForEnrollments({
                enrollments: [{
                    ...enrollment,
                    userId,
                }],
                assignedBy: user,
                username: enrollment.user.email,
                temporaryPassword: null,
            }).catch(() => {});
        }

        return enrollment;
    }
    async bulkEnroll(data, user = null) {
        const { userIds, courseId, expiresAt } = data;

        const course = await this.validateCourseAccess(courseId, user);
        if (!course) throw new Error('Course not found');
        if (!course.isActive) throw new Error('Course is not active');

        const tenantId = await this._resolveTenantId(user);

        const users = await prisma.user.findMany({
            where: {
                id: { in: userIds },
                isActive: true,
                status: 'ACTIVE',
                ...(user?.level !== 'PLATFORM_ADMIN' && tenantId && { tenantId }),
            },
            select: { id: true, email: true, firstName: true, lastName: true },
        });

        if (users.length === 0) throw new Error('No valid users found');

        const existingEnrollments = await prisma.enrollment.findMany({
            where: { courseId, userId: { in: userIds } },
            select: { userId: true, status: true },
        });

        const existingUserIds = new Set(existingEnrollments.map(e => e.userId));
        const completedUserIds = existingEnrollments
            .filter(e => e.status === 'COMPLETED')
            .map(e => e.userId);

        const usersToEnroll = users.filter(u => !existingUserIds.has(u.id));
        if (usersToEnroll.length === 0) {
            throw new Error('All users are already enrolled or have completed this course');
        }

        const calculatedExpiresAt = expiresAt || addDays(new Date(), course.validityDays || 90);

        const enrollments = await prisma.$transaction(
            usersToEnroll.map(u =>
                prisma.enrollment.create({
                    data: {
                        courseId,
                        userId: u.id,
                        expiresAt: calculatedExpiresAt,
                        status: 'NOT_STARTED',
                    },
                    include: {
                        user: { select: { id: true, email: true, firstName: true, lastName: true } },
                        course: { select: { id: true, slug: true, courseTitle: true } },
                    },
                })
            )
        );

        await Promise.all(
            enrollments.map((enrollment) =>
                credentialDeliveryService.recordForEnrollments({
                    enrollments: [{
                        ...enrollment,
                        userId: enrollment.userId,
                    }],
                    assignedBy: user,
                    username: enrollment.user.email,
                    temporaryPassword: null,
                }).catch(() => {}),
            ),
        );

        return {
            total: users.length,
            alreadyEnrolled: existingUserIds.size,
            completed: completedUserIds.length,
            newlyEnrolled: enrollments.length,
            enrollments,
        };
    }
    async getEnrollments(queryParams = {}, userId = null, user = null, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        if (user?.level === 'PLATFORM_ADMIN') {
            where.course = {
                ...(queryParams.tenantId && { tenantId: queryParams.tenantId }),
                createdById: user.id,
            };
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee user must have a tenant');
            where.course = { tenantId, createdById: user.id };
        } else {
            if (!userId && user?.id) userId = user.id;
            if (userId) where.userId = userId;
        }

        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.userId && user?.level === 'PLATFORM_ADMIN') where.userId = queryParams.userId;
        if (queryParams.companyContextId) where.companyContextId = queryParams.companyContextId;

        if (queryParams.search) {
            where.OR = [
                { user: { email: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { firstName: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: queryParams.search, mode: 'insensitive' } } },
                { course: { slug: { contains: queryParams.search, mode: 'insensitive' } } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [enrollments, total] = await Promise.all([
            prisma.enrollment.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true, level: true },
                    },
                    course: {
                        select: LICENSEE_COURSE_SELECT,
                    },
                    packagePurchase: {
                        select: { id: true, package: { select: { id: true, name: true } } },
                    },
                    companyContext: { select: { id: true, name: true } },
                    _count: { select: { lessonProgress: true, quizAttempts: true } },
                },
            }),
            prisma.enrollment.count({ where }),
        ]);

        const enrollmentsWithProgress = await Promise.all(
            enrollments.map(async enrollment => {
                const progress = await this._computeEnrollmentProgress(enrollment.id, enrollment.courseId);
                return {
                    ...enrollment,
                    course: formatLicenseeCourse(enrollment.course, locale),
                    user: formatStudentUser(enrollment.user),
                    progress,
                };
            })
        );

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            enrollments: enrollmentsWithProgress,
        };
    }
    async getEnrollmentById(id, userId = null, user = null) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id },
            include: {
                user: {
                    select: { id: true, email: true, firstName: true, lastName: true, level: true },
                },
                course: {
                    include: {
                        lessons: {
                            orderBy: { orderIndex: 'asc' },
                            select: {
                                id: true,
                                title: true,
                                orderIndex: true,
                                contentType: true,
                                durationSecs: true,
                                isRequired: true,
                                isLocked: true,
                            },
                        },
                        teacher: {
                            select: { id: true, firstName: true, lastName: true, email: true },
                        },
                    },
                },
                lessonProgress: {
                    orderBy: { lesson: { orderIndex: 'asc' } },
                    include: {
                        lesson: { select: { id: true, title: true, orderIndex: true } },
                    },
                },
                quizAttempts: {
                    orderBy: { attemptedAt: 'desc' },
                    include: {
                        quiz: {
                            select: {
                                id: true,
                                quizTitle: true,
                                quizType: true,
                                passScorePercent: true,
                            },
                        },
                    },
                },
                payment: true,
                certificate: true,
                packagePurchase: {
                    select: { id: true, package: { select: { id: true, name: true } } },
                },
                companyContext: { select: { id: true, name: true } },
            },
        });

        if (!enrollment) return null;

        if (user?.level === 'PLATFORM_ADMIN') {
            if (enrollment.course?.createdById !== user.id) return null;
            return enrollment;
        }

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (enrollment.course?.tenantId !== tenantId) return null;
            if (enrollment.course?.createdById !== user.id) return null;
            return enrollment;
        }

        const effectiveUserId = userId || user?.id;
        if (effectiveUserId && enrollment.userId !== effectiveUserId) return null;

        return enrollment;
    }
    async updateEnrollment(id, data, userId = null, user = null) {
        const enrollment = await this.getEnrollmentById(id, userId, user);
        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.status === 'COMPLETED') throw new Error('Cannot update completed enrollment');

        if (data.status === 'COMPLETED' && !data.completedAt) data.completedAt = new Date();
        if (data.status === 'IN_PROGRESS' && !data.startedAt) data.startedAt = new Date();

        return prisma.enrollment.update({
            where: { id },
            data,
            include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
                course: { select: { id: true, slug: true, courseTitle: true, tenantId: true } },
            },
        });
    }
    async deleteEnrollment(id, user = null) {
        const enrollment = await this.getEnrollmentById(id, null, user);
        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.status === 'COMPLETED') throw new Error('Cannot delete completed enrollment');
        return prisma.enrollment.delete({ where: { id } });
    }
    async updateLessonProgress(enrollmentId, lessonId, data, user = null) {
        const enrollment = await this.getEnrollmentById(enrollmentId, null, user);
        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.status === 'COMPLETED') throw new Error('Course already completed');
        if (enrollment.status === 'EXPIRED') throw new Error('Enrollment expired');

        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { id: true, courseId: true, contentType: true },
        });
        if (!lesson) throw new Error('Lesson not found');
        if (lesson.courseId !== enrollment.courseId) {
            throw new Error('Lesson does not belong to this course');
        }

        if (['SCORM', 'SCORM_12'].includes(lesson.contentType)) {
            throw new Error(
                'SCORM lesson progress is managed automatically by the SCORM player. ' +
                'Use the /scorm/launch → /scorm/finish flow instead.'
            );
        }

        const isCompleted = data.completed ?? true;
        const timeSpentSecs = data.timeSpentSecs ?? 0;
        const watchPercent = data.watchPercent ?? undefined;
        const lastPositionSecs = data.lastPositionSecs ?? undefined;

        const existing = await prisma.lessonProgress.findUnique({
            where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
            select: { timeSpentSecs: true, watchPercent: true, lastPositionSecs: true, completed: true, completedAt: true },
        });

        const progress = await prisma.lessonProgress.upsert({
            where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
            update: {
                completed: isCompleted || (existing?.completed ?? false),
                completedAt: (isCompleted || existing?.completed) ? (existing?.completedAt ?? new Date()) : null,
                timeSpentSecs: Math.max(existing?.timeSpentSecs ?? 0, timeSpentSecs),
                watchPercent: watchPercent != null
                    ? Math.max(existing?.watchPercent ?? 0, watchPercent)
                    : existing?.watchPercent ?? 0,
                lastPositionSecs: lastPositionSecs != null
                    ? Math.max(existing?.lastPositionSecs ?? 0, lastPositionSecs)
                    : existing?.lastPositionSecs ?? 0,
            },
            create: {
                enrollmentId,
                lessonId,
                completed: isCompleted,
                completedAt: isCompleted ? new Date() : null,
                timeSpentSecs,
                watchPercent: watchPercent ?? 0,
                lastPositionSecs: lastPositionSecs ?? 0,
                startedAt: new Date(),
            },
        });

        if (isCompleted || progress.completed) {
            await this.checkAndUpdateEnrollmentStatus(enrollmentId);
        }

        return progress;
    }

    async logAntiCheatEvent(enrollmentId, userId, payload) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: {
                id: true,
                userId: true,
                status: true,
                expiresAt: true,
                courseId: true,
            },
        });

        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.userId !== userId) {
            throw new Error('Permission denied: You can only log events for your own enrollment');
        }
        if (['EXPIRED', 'SUSPENDED'].includes(enrollment.status)) {
            throw new Error('Enrollment is not active');
        }
        if (enrollment.expiresAt < new Date()) {
            throw new Error('Course access has expired');
        }

        if (payload.lessonId) {
            const lesson = await prisma.lesson.findUnique({
                where: { id: payload.lessonId },
                select: { id: true, courseId: true },
            });
            if (!lesson || lesson.courseId !== enrollment.courseId) {
                throw new Error('Lesson does not belong to this enrollment course');
            }
        }

        const log = await prisma.antiCheatLog.create({
            data: {
                enrollmentId,
                lessonId: payload.lessonId ?? null,
                eventType: payload.eventType,
                metadata: payload.metadata ?? null,
                retentionUntil: await computeRetentionUntil(),
            },
        });

        return log;
    }
    async checkAndUpdateEnrollmentStatus(enrollmentId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { status: true, courseId: true },
        });
        if (!enrollment || enrollment.status === 'COMPLETED') {
            if (enrollment?.status === 'COMPLETED') {
                try {
                    await certificateService.autoGenerateOnCompletion(enrollmentId);
                } catch (err) {
                    console.error(
                        `Certificate ensure failed for completed enrollment ${enrollmentId}:`,
                        err.message,
                    );
                }
            }
            return null;
        }

        const requiredLessons = await prisma.lesson.findMany({
            where: { courseId: enrollment.courseId, isRequired: true },
            select: { id: true, contentType: true },
        });

        let lessonsCompleted = true;
        let anyProgress = false;

        if (requiredLessons.length > 0) {
            const progressRecords = await prisma.lessonProgress.findMany({
                where: { enrollmentId, lessonId: { in: requiredLessons.map(l => l.id) } },
                select: { lessonId: true, completed: true, scormStatus: true },
            });
            anyProgress = progressRecords.length > 0;
            const progressMap = new Map(progressRecords.map(p => [p.lessonId, p]));

            lessonsCompleted = requiredLessons.every(lesson => {
                const p = progressMap.get(lesson.id);
                if (!p) return false;
                if (['SCORM', 'SCORM_12'].includes(lesson.contentType)) {
                    return ['COMPLETED', 'PASSED'].includes(p.scormStatus);
                }
                return p.completed === true;
            });
        }

        const publishedQuizzes = await prisma.quiz.findMany({
            where: {
                courseId: enrollment.courseId,
                isActive: true,
                isPublished: true,
            },
            select: { id: true, quizType: true },
        });

        const quizPriority = { FINAL_TEST: 3, POST_TEST: 2, PRE_TEST: 1 };
        const gatingQuiz = publishedQuizzes
            .slice()
            .sort((a, b) => (quizPriority[b.quizType] ?? 0) - (quizPriority[a.quizType] ?? 0))[0] ?? null;

        let finalTestPassed = true;
        if (gatingQuiz) {
            const passedAttempt = await prisma.quizAttempt.findFirst({
                where: { quizId: gatingQuiz.id, enrollmentId, passed: true },
                select: { id: true },
            });
            finalTestPassed = !!passedAttempt;
            anyProgress = anyProgress || !!passedAttempt;
        }

        const hasAnyRequirement = requiredLessons.length > 0 || !!gatingQuiz;
        if (hasAnyRequirement && lessonsCompleted && finalTestPassed) {
            const updated = await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });

            try {
                await certificateService.autoGenerateOnCompletion(enrollmentId);
            } catch (err) {
                console.error(`Certificate auto-generation failed for enrollment ${enrollmentId}:`, err.message);
            }

            return updated;
        }

        if (enrollment.status === 'NOT_STARTED' && anyProgress) {
            return prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'IN_PROGRESS', startedAt: new Date() },
            });
        }

        return null;
    }
    async getEnrollmentStats(courseId = null, user = null) {
        const where = {};
        if (courseId) {
            if (user && ['PLATFORM_ADMIN', 'LICENSE_USER'].includes(user.level)) {
                const course = await this.validateCourseAccess(courseId, user);
                if (!course) throw new Error('Course not found');
            }
            where.courseId = courseId;
        }

        if (user?.level === 'PLATFORM_ADMIN') {
            where.course = { createdById: user.id };
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee must have a tenant');
            where.course = { tenantId, createdById: user.id };
        } else if (user?.tenantId) {
            where.course = { tenantId: user.tenantId };
        }

        const [stats, statusBreakdown] = await Promise.all([
            prisma.enrollment.aggregate({ where, _count: { _all: true } }),
            prisma.enrollment.groupBy({ by: ['status'], where, _count: { _all: true } }),
        ]);

        return {
            totalEnrollments: stats._count._all,
            statusBreakdown: statusBreakdown.reduce((acc, item) => {
                acc[item.status] = item._count._all;
                return acc;
            }, {}),
        };
    }
    async ensureMyCertificate(courseId, userId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, status: true },
        });

        if (!enrollment) {
            throw new Error('Enrollment not found');
        }

        if (enrollment.status !== 'COMPLETED') {
            throw new Error('Course is not completed yet');
        }

        const certificate = await certificateService.ensureCertificateForEnrollment(enrollment.id);

        return {
            enrollmentId: enrollment.id,
            certificate: {
                id: certificate.id,
                status: certificate.status,
                pdfUrl: certificate.pdfUrl ?? null,
                issuedAt: certificate.issuedAt ?? null,
                downloadableUntil: certificate.downloadableUntil ?? null,
            },
        };
    }

    async getMyProgress(courseId, userId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, status: true, startedAt: true, completedAt: true },
        });

        if (!enrollment) return { enrolled: false, progress: null };

        const lessons = await prisma.lesson.findMany({
            where: { courseId },
            orderBy: { orderIndex: 'asc' },
            include: {
                progress: {
                    where: { enrollmentId: enrollment.id },
                    select: {
                        completed: true,
                        timeSpentSecs: true,
                        startedAt: true,
                        completedAt: true,
                        scormStatus: true,
                        scormScore: true,
                        scormPassed: true,
                    },
                },
            },
        });

        const totalLessons = lessons.length;
        const completedLessons = lessons.filter(l => {
            const p = l.progress[0];
            if (!p) return false;
            if (['SCORM', 'SCORM_12'].includes(l.contentType)) {
                return ['COMPLETED', 'PASSED'].includes(p.scormStatus);
            }
            return p.completed === true;
        }).length;

        const percentage = totalLessons > 0
            ? Math.round((completedLessons / totalLessons) * 100)
            : 0;

        return {
            enrolled: true,
            enrollmentId: enrollment.id,
            status: enrollment.status,
            startedAt: enrollment.startedAt,
            completedAt: enrollment.completedAt,
            progress: {
                totalLessons,
                completedLessons,
                percentage,
                lessons: lessons.map(lesson => {
                    const p = lesson.progress[0] || null;
                    const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);
                    const isCompleted = isScorm
                        ? ['COMPLETED', 'PASSED'].includes(p?.scormStatus)
                        : (p?.completed ?? false);

                    return {
                        id: lesson.id,
                        title: lesson.title,
                        orderIndex: lesson.orderIndex,
                        contentType: lesson.contentType,
                        isTracked: isScorm,
                        isCompleted,
                        timeSpentSecs: p?.timeSpentSecs ?? 0,
                        startedAt: p?.startedAt ?? null,
                        completedAt: p?.completedAt ?? null,
                        scormStatus: isScorm ? (p?.scormStatus ?? 'NOT_ATTEMPTED') : null,
                        scormScore: isScorm ? (p?.scormScore ?? null) : null,
                        scormPassed: isScorm ? (p?.scormPassed ?? false) : null,
                    };
                }),
            },
        };
    }


    async validateCourseAccess(courseId, user) {
        const where = { id: courseId };

        if (user?.level === 'PLATFORM_ADMIN') {
            where.createdById = user.id;
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee user must have a tenant');
            where.tenantId = tenantId;
            where.createdById = user.id;
        } else if (user?.tenantId) {
            where.tenantId = user.tenantId;
        }

        return prisma.course.findUnique({
            where,
            select: { id: true, isActive: true, validityDays: true, slug: true, tenantId: true, createdById: true },
        });
    }

    async validateUserAccess(userId, user) {
        if (user?.level === 'LICENSE_USER') {
            const foundUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, isActive: true, status: true },
            });
            if (!foundUser) throw new Error('User not found');
            if (!foundUser.isActive || foundUser.status === 'SUSPENDED') {
                throw new Error('User is not active');
            }
            return foundUser;
        }

        const where = { id: userId };

        if (user?.level === 'PLATFORM_ADMIN') {
            // no filter
        } else if (user?.tenantId) {
            where.tenantId = user.tenantId;
        }

        const foundUser = await prisma.user.findUnique({
            where,
            select: { id: true, isActive: true, status: true },
        });

        if (!foundUser) throw new Error('User not found');
        if (!foundUser.isActive || foundUser.status === 'SUSPENDED') {
            throw new Error('User is not active');
        }

        return foundUser;
    }

    async validatePackagePurchase(packagePurchaseId) {
        const packagePurchase = await prisma.packagePurchase.findUnique({
            where: { id: packagePurchaseId },
            select: { id: true, expiresAt: true, seatsTotal: true, seatsUsed: true },
        });

        if (!packagePurchase) throw new Error('Package purchase not found');
        if (packagePurchase.expiresAt < new Date()) throw new Error('Package purchase has expired');
        if (packagePurchase.seatsUsed >= packagePurchase.seatsTotal) {
            throw new Error('No seats available in this package');
        }

        return packagePurchase;
    }
    async getLicenseeAllEnrollments(queryParams = {}, user = null, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const { tenantId } = await this._getLicenseeContext(user, queryParams);
        const courseIds = await this._getLicenseeCourseIds(user, queryParams);

        if (courseIds.length === 0) {
            return {
                meta: { page, limit, total: 0, totalPages: 0, tenantId, licenseeId: user.id },
                stats: {
                    totalCourses: 0,
                    totalEnrollments: 0,
                    activeStudents: 0,
                    completedStudents: 0,
                    statusBreakdown: {},
                    courseBreakdown: [],
                },
                enrollments: [],
            };
        }

        const where = { courseId: { in: courseIds } };

        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.userId) where.userId = queryParams.userId;

        if (queryParams.search) {
            where.OR = [
                { user: { email: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { firstName: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: queryParams.search, mode: 'insensitive' } } },
                { course: { slug: { contains: queryParams.search, mode: 'insensitive' } } },
                { course: { courseTitle: { path: ['en'], string_contains: queryParams.search } } },
                { course: { courseTitle: { path: ['it'], string_contains: queryParams.search } } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [enrollments, total] = await Promise.all([
            prisma.enrollment.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            level: true,
                            companyName: true,
                            tenantId: true,
                        },
                    },
                    course: {
                        select: LICENSEE_COURSE_SELECT,
                    },
                    packagePurchase: {
                        select: {
                            id: true,
                            package: { select: { id: true, name: true } },
                        },
                    },
                    companyContext: { select: { id: true, name: true } },
                    payment: {
                        select: { id: true, amount: true, status: true, type: true },
                    },
                    certificate: {
                        select: {
                            id: true,
                            status: true,
                            issuedAt: true,
                            pdfUrl: true,
                            downloadableUntil: true,
                        },
                    },
                    _count: {
                        select: { lessonProgress: true, quizAttempts: true },
                    },
                },
            }),
            prisma.enrollment.count({ where }),
        ]);

        const enrollmentsWithProgress = await Promise.all(
            enrollments.map(async enrollment => {
                const progress = await this._computeEnrollmentProgress(enrollment.id, enrollment.courseId);

                return {
                    ...enrollment,
                    course: formatLicenseeCourse(enrollment.course, locale),
                    user: formatStudentUser(enrollment.user),
                    progress,
                    courseSummary: {
                        title: pickLocalizedTitle(enrollment.course.courseTitle, locale),
                        format: enrollment.course.format,
                        category: enrollment.course.category,
                        isActive: enrollment.course.isActive,
                        validityDays: enrollment.course.validityDays,
                        lessonCount: enrollment.course._count?.lessons ?? 0,
                    },
                    userSummary: {
                        name: `${enrollment.user.firstName || ''} ${enrollment.user.lastName || ''}`.trim() || enrollment.user.email,
                        email: enrollment.user.email,
                    },
                    certificateDownload: enrollment.certificate?.pdfUrl
                        ? {
                            certificateId: enrollment.certificate.id,
                            pdfUrl: enrollment.certificate.pdfUrl,
                            status: enrollment.certificate.status,
                        }
                        : null,
                };
            })
        );

        const stats = await this.getLicenseeEnrollmentStats(where, tenantId, user);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                tenantId: tenantId,
                licenseeId: user.id,
                licenseeName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            },
            stats,
            enrollments: enrollmentsWithProgress,
        };
    }
    async getLicenseeEnrollmentStats(where = {}, tenantId = null, user = null) {
        const courseWhere = {
            ...(tenantId && { tenantId }),
            ...(user?.id && { createdById: user.id }),
        };

        const [totalCourses, courseStats, enrollmentStats, statusBreakdown] = await Promise.all([
            // Total courses
            prisma.course.count({ where: courseWhere }),

            // Course-wise enrollment counts
            prisma.course.findMany({
                where: courseWhere,
                select: {
                    id: true,
                    courseTitle: true,
                    slug: true,
                    _count: {
                        select: {
                            enrollments: true,
                        },
                    },
                },
            }),

            // Total enrollments
            prisma.enrollment.count({ where }),

            // Status breakdown
            prisma.enrollment.groupBy({
                by: ['status'],
                where,
                _count: { _all: true },
            }),
        ]);

        // Active students (unique users with active enrollments)
        const activeStudents = await prisma.enrollment.groupBy({
            by: ['userId'],
            where: {
                ...where,
                status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
            },
            _count: { _all: true },
        });

        // Completed students
        const completedStudents = await prisma.enrollment.groupBy({
            by: ['userId'],
            where: {
                ...where,
                status: 'COMPLETED',
            },
            _count: { _all: true },
        });

        return {
            totalCourses,
            totalEnrollments: enrollmentStats,
            activeStudents: activeStudents.length,
            completedStudents: completedStudents.length,
            statusBreakdown: statusBreakdown.reduce((acc, item) => {
                acc[item.status] = item._count._all;
                return acc;
            }, {}),
            courseBreakdown: courseStats.map(course => ({
                id: course.id,
                title: course.courseTitle,
                slug: course.slug,
                totalEnrollments: course._count.enrollments,
            })),
        };
    }



    async getLicenseeStudents(queryParams = {}, user = null, locale = 'it') {
        await this._getLicenseeContext(user, queryParams);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const courseIds = await this._getLicenseeCourseIds(user, queryParams);
        const { tenantId } = await this._getLicenseeContext(user, queryParams);

        const licenseeCoursesIds = courseIds;

        if (licenseeCoursesIds.length === 0) {
            return {
                meta: { page, limit, total: 0, totalPages: 0, tenantId },
                stats: { totalStudents: 0, totalEnrollments: 0, activeStudents: 0, completedStudents: 0, totalCourses: 0 },
                students: [],
            };
        }

        const enrollmentWhere = {
            courseId: { in: licenseeCoursesIds },
            ...(queryParams.status && { status: queryParams.status }),
            ...(queryParams.courseId && { courseId: queryParams.courseId }),
        };

        // Search filter via user relation
        if (queryParams.search) {
            enrollmentWhere.user = {
                OR: [
                    { email: { contains: queryParams.search, mode: 'insensitive' } },
                    { firstName: { contains: queryParams.search, mode: 'insensitive' } },
                    { lastName: { contains: queryParams.search, mode: 'insensitive' } },
                ],
            };
        }

        // ── Get all unique student IDs (no groupBy ordering trick — use findMany distinct instead) ──
        // Prisma groupBy orderBy _count is unreliable across versions; use raw distinct approach
        const allEnrollmentsForCount = await prisma.enrollment.findMany({
            where: enrollmentWhere,
            select: { userId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });

        const allStudentIds = uniqueStudentIdsOrdered(allEnrollmentsForCount);
        const totalStudents = allStudentIds.length;

        // Paginate student IDs manually
        const paginatedStudentIds = allStudentIds.slice(skip, skip + limit);

        if (paginatedStudentIds.length === 0) {
            return {
                meta: { page, limit, total: totalStudents, totalPages: Math.ceil(totalStudents / limit) },
                stats: { totalStudents: 0, totalEnrollments: 0, activeStudents: 0, completedStudents: 0, totalCourses: licenseeCoursesIds.length },
                students: [],
            };
        }

        // ── Fetch all enrollments for paginated students ──
        const enrollments = await prisma.enrollment.findMany({
            where: {
                userId: { in: paginatedStudentIds },
                courseId: { in: licenseeCoursesIds },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        level: true,
                        companyName: true,
                        birthDate: true,
                        traineeTaxCode: true,
                        contactNumber: true,
                    },
                },
                course: {
                    select: LICENSEE_COURSE_SELECT,
                },
                certificate: {
                    select: { id: true, status: true, issuedAt: true, pdfUrl: true },
                },
                lessonProgress: {
                    select: {
                        lessonId: true,
                        completed: true,
                        scormStatus: true,
                        timeSpentSecs: true,
                        lastPositionSecs: true,
                    },
                },
                quizAttempts: {
                    orderBy: { attemptedAt: 'desc' },
                    include: {
                        quiz: { select: { id: true, quizTitle: true, quizType: true, passScorePercent: true } },
                    },
                },
            },
        });

        // ── Batch lesson counts per course ──
        const lessonCountsRaw = await prisma.lesson.groupBy({
            by: ['courseId'],
            where: { courseId: { in: licenseeCoursesIds } },
            _count: { _all: true },
        });
        const lessonCountMap = new Map(lessonCountsRaw.map(r => [r.courseId, r._count._all]));

        // ── Group enrollments by student ──
        const studentMap = new Map();

        for (const enrollment of enrollments) {
            const uid = enrollment.userId;
            if (!studentMap.has(uid)) {
                studentMap.set(uid, { user: formatStudentUser(enrollment.user), enrollments: [] });
            }

            const totalLessons = lessonCountMap.get(enrollment.courseId) ?? 0;
            const completedLessons = enrollment.lessonProgress.filter(p => {
                if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
                return p.completed === true;
            }).length;
            const totalTime = enrollment.lessonProgress.reduce(
                (s, p) => s + effectiveLessonTimeSecs(p),
                0,
            );

            const bestQuizByType = {};
            for (const attempt of enrollment.quizAttempts) {
                const type = attempt.quiz?.quizType ?? 'UNKNOWN';
                if (!bestQuizByType[type] || attempt.scorePercent > bestQuizByType[type].scorePercent) {
                    bestQuizByType[type] = attempt;
                }
            }

            studentMap.get(uid).enrollments.push({
                enrollmentId: enrollment.id,
                status: enrollment.status,
                startedAt: enrollment.startedAt,
                completedAt: enrollment.completedAt,
                expiresAt: enrollment.expiresAt,
                createdAt: enrollment.createdAt,
                course: formatLicenseeCourse(enrollment.course, locale),
                progress: {
                    totalLessons,
                    completedLessons,
                    percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                    totalTimeSpentSecs: totalTime,
                },
                quizAttempts: {
                    total: enrollment.quizAttempts.length,
                    best: bestQuizByType,
                    all: enrollment.quizAttempts.map(a => ({
                        id: a.id,
                        quizId: a.quizId,
                        quizTitle: pickLocalizedTitle(a.quiz?.quizTitle, locale),
                        quizType: a.quiz?.quizType,
                        scorePercent: a.scorePercent,
                        passed: a.passed,
                        attemptedAt: a.attemptedAt,
                    })),
                },
                certificate: enrollment.certificate ?? null,
            });
        }

        // ── Build final student list (preserve pagination order) ──
        const students = paginatedStudentIds.map(uid => {
            const data = studentMap.get(uid);
            if (!data) return null;
            const enrs = data.enrollments;
            const totalEnr = enrs.length;
            const completed = enrs.filter(e => e.status === 'COMPLETED').length;
            const avgProgress = totalEnr > 0
                ? Math.round(enrs.reduce((s, e) => s + e.progress.percentage, 0) / totalEnr)
                : 0;
            const totalTime = enrs.reduce((s, e) => s + e.progress.totalTimeSpentSecs, 0);
            const totalQuizAttempts = enrs.reduce((s, e) => s + e.quizAttempts.total, 0);

            return {
                student: data.user,
                summary: {
                    totalEnrollments: totalEnr,
                    completedCourses: completed,
                    inProgressCourses: enrs.filter(e => e.status === 'IN_PROGRESS').length,
                    notStartedCourses: enrs.filter(e => e.status === 'NOT_STARTED').length,
                    averageProgress: avgProgress,
                    totalTimeSpentSecs: totalTime,
                    totalQuizAttempts,
                    certificatesEarned: enrs.filter(e => e.certificate?.status === 'ISSUED').length,
                },
                enrollments: enrs,
            };
        }).filter(Boolean);

        // ── Overall stats (flat counts, no groupBy with not:null) ──
        const [totalEnrollmentsCount, activeStudentIds, completedStudentIds] = await Promise.all([
            prisma.enrollment.count({
                where: { courseId: { in: licenseeCoursesIds } },
            }),
            prisma.enrollment.findMany({
                where: { courseId: { in: licenseeCoursesIds }, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
                select: { userId: true },
                distinct: ['userId'],
            }),
            prisma.enrollment.findMany({
                where: { courseId: { in: licenseeCoursesIds }, status: 'COMPLETED' },
                select: { userId: true },
                distinct: ['userId'],
            }),
        ]);

        return {
            meta: {
                page,
                limit,
                total: totalStudents,
                totalPages: Math.ceil(totalStudents / limit),
                tenantId,
                licenseeId: user.id,
            },
            stats: {
                totalStudents,
                totalEnrollments: totalEnrollmentsCount,
                activeStudents: activeStudentIds.length,
                completedStudents: completedStudentIds.length,
                totalCourses: licenseeCoursesIds.length,
            },
            students,
        };
    }

    async getLicenseeStudentDetail(studentId, user = null, locale = 'it') {
        const { tenantId } = await this._getLicenseeContext(user, {});
        const licenseeCoursesIds = await this._getLicenseeCourseIds(user, {});

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                level: true,
                companyName: true,
                birthDate: true,
                city: true,
                country: true,
                traineeTaxCode: true,
                residenceAddress: true,
                contactNumber: true,
                createdAt: true,
            },
        });
        if (!student) throw new Error('Student not found');

        // All enrollments for this student within licensee courses
        const enrollments = await prisma.enrollment.findMany({
            where: {
                userId: studentId,
                courseId: { in: licenseeCoursesIds },
            },
            include: {
                course: {
                    select: {
                        ...LICENSEE_COURSE_SELECT,
                        lessons: {
                            orderBy: { orderIndex: 'asc' },
                            select: {
                                id: true,
                                title: true,
                                orderIndex: true,
                                contentType: true,
                                durationSecs: true,
                                isRequired: true,
                                isLocked: true,
                            },
                        },
                    },
                },
                lessonProgress: {
                    include: {
                        lesson: { select: { id: true, title: true, orderIndex: true, contentType: true } },
                    },
                },
                quizAttempts: {
                    orderBy: { attemptedAt: 'desc' },
                    include: {
                        quiz: {
                            select: { id: true, quizTitle: true, quizType: true, passScorePercent: true },
                        },
                    },
                },
                certificate: {
                    select: {
                        id: true,
                        status: true,
                        issuedAt: true,
                        pdfUrl: true,
                        downloadableUntil: true,
                    },
                },
                antiCheatLogs: {
                    orderBy: { occurredAt: 'desc' },
                    take: 20,
                    select: { id: true, eventType: true, occurredAt: true, lessonId: true, retentionUntil: true },
                },
                _count: {
                    select: { antiCheatLogs: true },
                },
            },
        });

        if (enrollments.length === 0) {
            throw new Error('Student not found in your courses or has no enrollments');
        }

        const progressMap = p => {
            const isScorm = ['SCORM', 'SCORM_12'].includes(p.lesson?.contentType);
            const done = isScorm
                ? ['COMPLETED', 'PASSED'].includes(p.scormStatus)
                : p.completed === true;
            return {
                lessonId: p.lessonId,
                lessonTitle: pickLocalizedTitle(p.lesson?.title, locale),
                orderIndex: p.lesson?.orderIndex,
                contentType: p.lesson?.contentType,
                isScorm,
                completed: done,
                scormStatus: isScorm ? (p.scormStatus ?? 'NOT_ATTEMPTED') : null,
                scormScore: isScorm ? p.scormScore : null,
                timeSpentSecs: effectiveLessonTimeSecs(p),
                watchPercent: p.watchPercent ?? 0,
                lastPositionSecs: p.lastPositionSecs ?? 0,
                startedAt: p.startedAt,
                completedAt: p.completedAt,
            };
        };

        const courseDetails = enrollments.map(enrollment => {
            const totalLessons = enrollment.course.lessons.length;
            const progressRecords = enrollment.lessonProgress.map(progressMap);
            const completedLessons = progressRecords.filter(p => p.completed).length;
            const totalTime = progressRecords.reduce((s, p) => s + p.timeSpentSecs, 0);

            // Quiz summary
            const quizSummary = {};
            for (const attempt of enrollment.quizAttempts) {
                const type = attempt.quiz?.quizType ?? 'UNKNOWN';
                if (!quizSummary[type]) {
                    quizSummary[type] = { attempts: [], bestScore: 0, passed: false };
                }
                quizSummary[type].attempts.push({
                    id: attempt.id,
                    quizTitle: pickLocalizedTitle(attempt.quiz?.quizTitle, locale),
                    quizType: type,
                    scorePercent: attempt.scorePercent,
                    passed: attempt.passed,
                    attemptedAt: attempt.attemptedAt,
                    answers: attempt.answers,
                });
                if (attempt.scorePercent > quizSummary[type].bestScore) {
                    quizSummary[type].bestScore = attempt.scorePercent;
                    quizSummary[type].passed = attempt.passed;
                }
            }

            return {
                enrollmentId: enrollment.id,
                status: enrollment.status,
                startedAt: enrollment.startedAt,
                completedAt: enrollment.completedAt,
                expiresAt: enrollment.expiresAt,
                createdAt: enrollment.createdAt,
                course: {
                    ...formatLicenseeCourse(enrollment.course, locale),
                    lessons: (enrollment.course.lessons || []).map(l => formatLicenseeLesson(l, locale)),
                },
                progress: {
                    totalLessons,
                    completedLessons,
                    percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                    totalTimeSpentSecs: totalTime,
                    lessons: progressRecords,
                },
                quizzes: {
                    totalAttempts: enrollment.quizAttempts.length,
                    byType: quizSummary,
                },
                certificate: enrollment.certificate
                    ? {
                        ...enrollment.certificate,
                        downloadUrl: enrollment.certificate.pdfUrl,
                    }
                    : null,
                antiCheat: {
                    totalEvents: enrollment._count?.antiCheatLogs ?? enrollment.antiCheatLogs?.length ?? 0,
                    recent: enrollment.antiCheatLogs ?? [],
                },
                signature: {
                    url: enrollment.participantSignatureUrl ?? null,
                    uploadedAt: enrollment.signatureUploadedAt ?? null,
                    confirmedAt: enrollment.trainingReportConfirmedAt ?? null,
                },
            };
        });

        // Overall summary
        const totalCourses = courseDetails.length;
        const completedCourses = courseDetails.filter(c => c.status === 'COMPLETED').length;
        const avgProgress = totalCourses > 0
            ? Math.round(courseDetails.reduce((s, c) => s + c.progress.percentage, 0) / totalCourses)
            : 0;
        const totalTime = courseDetails.reduce((s, c) => s + c.progress.totalTimeSpentSecs, 0);
        const totalQuizzes = courseDetails.reduce((s, c) => s + c.quizzes.totalAttempts, 0);

        return {
            student: formatStudentUser(student),
            tenantId,
            summary: {
                totalEnrollments: totalCourses,
                completedCourses,
                inProgressCourses: courseDetails.filter(c => c.status === 'IN_PROGRESS').length,
                notStartedCourses: courseDetails.filter(c => c.status === 'NOT_STARTED').length,
                averageProgress: avgProgress,
                totalTimeSpentSecs: totalTime,
                totalQuizAttempts: totalQuizzes,
                certificatesEarned: courseDetails.filter(c => c.certificate?.status === 'ISSUED').length,
            },
            courses: courseDetails,
        };
    }

    async _assertEnrollmentReportAccess(enrollmentId, user) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { id: true, userId: true, courseId: true },
        });
        if (!enrollment) throw new Error('Enrollment not found');

        if (enrollment.userId === user.id) {
            return enrollment;
        }

        if (['LICENSE_USER', 'PLATFORM_ADMIN'].includes(user.level)) {
            const licenseeCourseIds = await this._getLicenseeCourseIds(user, {});
            if (licenseeCourseIds.includes(enrollment.courseId)) {
                return enrollment;
            }
        }

        throw new Error('You do not have permission to manage this training report');
    }

    async uploadParticipantSignature(enrollmentId, signatureUrl, user = null) {
        if (!signatureUrl) throw new Error('Signature file is required');
        await this._assertEnrollmentReportAccess(enrollmentId, user);

        return prisma.enrollment.update({
            where: { id: enrollmentId },
            data: {
                participantSignatureUrl: signatureUrl,
                signatureUploadedAt: new Date(),
                trainingReportConfirmedAt: null,
            },
            select: {
                id: true,
                participantSignatureUrl: true,
                signatureUploadedAt: true,
                trainingReportConfirmedAt: true,
            },
        });
    }

    async confirmTrainingReport(enrollmentId, user = null) {
        await this._assertEnrollmentReportAccess(enrollmentId, user);

        const current = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { participantSignatureUrl: true },
        });
        if (!current?.participantSignatureUrl) {
            throw new Error('Upload participant signature before confirming the report');
        }

        return prisma.enrollment.update({
            where: { id: enrollmentId },
            data: { trainingReportConfirmedAt: new Date() },
            select: {
                id: true,
                participantSignatureUrl: true,
                signatureUploadedAt: true,
                trainingReportConfirmedAt: true,
            },
        });
    }

    _buildAccessUrl(token) {
        const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
        if (!baseClientUrl || !token) return null;
        return `${baseClientUrl}/enrollments/access/${token}`;
    }

    async getAccessLinkInfo(token) {
        const enrollment = await prisma.enrollment.findFirst({
            where: { accessLinkToken: token },
            include: {
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                        slug: true,
                        thumbnailUrl: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        traineeTaxCode: true,
                        birthDate: true,
                        city: true,
                        residenceAddress: true,
                    },
                },
                companyContext: {
                    select: {
                        id: true,
                        name: true,
                        fiscalCode: true,
                        vatNumber: true,
                        fiscalAddress: true,
                    },
                },
            },
        });

        if (!enrollment) throw new Error('Access link not found');
        const now = new Date();
        const isExpired = Boolean(
            enrollment.accessLinkExpiresAt && enrollment.accessLinkExpiresAt < now,
        ) || enrollment.expiresAt < now;

        const requiresProfile = !enrollment.user.traineeTaxCode
            || !enrollment.user.birthDate
            || !enrollment.user.residenceAddress;

        return {
            enrollmentId: enrollment.id,
            course: enrollment.course,
            company: enrollment.companyContext,
            assignedEmail: enrollment.assignedEmail || enrollment.user.email,
            accessLinkUsed: enrollment.accessLinkUsed,
            isExpired,
            requiresProfile,
            user: {
                firstName: enrollment.user.firstName,
                lastName: enrollment.user.lastName,
                email: enrollment.user.email,
                taxCode: enrollment.user.traineeTaxCode,
                birthDate: enrollment.user.birthDate,
                birthPlace: enrollment.user.city,
                address: enrollment.user.residenceAddress,
            },
            accessUrl: this._buildAccessUrl(token),
        };
    }

    async redeemAccessLink(token, payload) {
        const enrollment = await prisma.enrollment.findFirst({
            where: { accessLinkToken: token },
            include: {
                user: { select: { id: true, email: true, companyId: true } },
                course: { select: { id: true, slug: true, courseTitle: true } },
                companyContext: {
                    select: { id: true, name: true, taxId: true, vatNumber: true, fiscalAddress: true },
                },
            },
        });

        if (!enrollment) throw new Error('Access link not found');
        if (enrollment.accessLinkUsed) throw new Error('This access link has already been used');
        const now = new Date();
        if (enrollment.accessLinkExpiresAt && enrollment.accessLinkExpiresAt < now) {
            throw new Error('This access link has expired');
        }
        if (enrollment.expiresAt < now) throw new Error('Course access has expired');

        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: enrollment.user.id },
                data: {
                    firstName: payload.firstName,
                    lastName: payload.lastName,
                    birthDate: payload.birthDate,
                    city: payload.birthPlace ?? null,
                    traineeTaxCode: payload.taxCode,
                    residenceAddress: payload.address,
                    profileCompleted: true,
                    status: 'ACTIVE',
                },
            });

            if (enrollment.companyContextId && payload.companyName) {
                await tx.company.update({
                    where: { id: enrollment.companyContextId },
                    data: {
                        name: payload.companyName,
                        fiscalAddress: payload.companyAddress ?? undefined,
                        fiscalCode: payload.companyTaxId ?? undefined,
                        vatNumber: payload.companyVatNumber ?? undefined,
                    },
                });
            }

            await tx.enrollment.update({
                where: { id: enrollment.id },
                data: {
                    accessLinkUsed: true,
                    assignedEmail: payload.email || enrollment.user.email,
                    status: enrollment.status === 'NOT_STARTED' ? 'NOT_STARTED' : enrollment.status,
                },
            });
        });

        return {
            enrollmentId: enrollment.id,
            courseId: enrollment.course.id,
            courseSlug: enrollment.course.slug,
            userId: enrollment.user.id,
            email: enrollment.user.email,
            loginUrl: '/auth/login',
            courseUrl: `/dashboard/company-employee/course/${enrollment.course.id}`,
        };
    }
}

export const enrollmentService = new EnrollmentService();