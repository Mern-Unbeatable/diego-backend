
import { prisma } from '../../config/db.js';
import { randomBytes } from 'crypto';
import { addDays } from 'date-fns';
import { certificateService } from '../certificate/certificate.service.js';

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
            select: { lessonId: true, completed: true, scormStatus: true, timeSpentSecs: true },
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

        const totalTimeSpentSecs = progressRecords.reduce((sum, p) => sum + (p.timeSpentSecs ?? 0), 0);

        return {
            totalLessons: lessons.length,
            completedLessons,
            percentage: Math.round((completedLessons / lessons.length) * 100),
            totalTimeSpentSecs,
        };
    }

    async getLicenseeOverview(queryParams = {}, user = null) {
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
                courseTitle: course.courseTitle,
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

        return prisma.$transaction(async tx => {
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
                    },
                })
            )
        );

        return {
            total: users.length,
            alreadyEnrolled: existingUserIds.size,
            completed: completedUserIds.length,
            newlyEnrolled: enrollments.length,
            enrollments,
        };
    }
    async getEnrollments(queryParams = {}, userId = null, user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        if (user?.level === 'PLATFORM_ADMIN') {
            if (queryParams.tenantId) where.course = { tenantId: queryParams.tenantId };
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee user must have a tenant');
            where.course = { tenantId };
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
                        select: {
                            id: true,
                            slug: true,
                            courseTitle: true,
                            format: true,
                            price: true,
                            thumbnailUrl: true,
                            tenantId: true,
                        },
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
                const [totalLessons, completedLessons] = await Promise.all([
                    prisma.lesson.count({ where: { courseId: enrollment.courseId } }),
                    prisma.lessonProgress.count({
                        where: { enrollmentId: enrollment.id, completed: true },
                    }),
                ]);
                return {
                    ...enrollment,
                    progress: {
                        totalLessons,
                        completedLessons,
                        percentage: totalLessons > 0
                            ? Math.round((completedLessons / totalLessons) * 100)
                            : 0,
                    },
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

        if (user?.level === 'PLATFORM_ADMIN') return enrollment;

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (enrollment.course?.tenantId !== tenantId) return null;
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

        const progress = await prisma.lessonProgress.upsert({
            where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
            update: {
                completed: isCompleted,
                completedAt: isCompleted ? new Date() : null,
                timeSpentSecs,
            },
            create: {
                enrollmentId,
                lessonId,
                completed: isCompleted,
                completedAt: isCompleted ? new Date() : null,
                timeSpentSecs,
                startedAt: new Date(),
            },
        });

        if (isCompleted) {
            await this.checkAndUpdateEnrollmentStatus(enrollmentId);
        }

        return progress;
    }
    async checkAndUpdateEnrollmentStatus(enrollmentId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { status: true, courseId: true },
        });
        if (!enrollment || enrollment.status === 'COMPLETED') return null;

        // ── ১. Required lessons সব শেষ কিনা ──
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

        // ── ২. Course-এ published FINAL_TEST থাকলে সেটা pass করা লাগবে ──
        const finalTest = await prisma.quiz.findFirst({
            where: { courseId: enrollment.courseId, quizType: 'FINAL_TEST', isActive: true, isPublished: true },
            select: { id: true },
        });

        let finalTestPassed = true;
        if (finalTest) {
            const passedAttempt = await prisma.quizAttempt.findFirst({
                where: { quizId: finalTest.id, enrollmentId, passed: true },
                select: { id: true },
            });
            finalTestPassed = !!passedAttempt;
            anyProgress = anyProgress || !!passedAttempt;
        }

        // ── ৩. দুটো শর্তই পূরণ হলে COMPLETED ──
        const hasAnyRequirement = requiredLessons.length > 0 || !!finalTest;
        if (hasAnyRequirement && lessonsCompleted && finalTestPassed) {
            const updated = await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });

            certificateService.autoGenerateOnCompletion(enrollmentId).catch(err => {
                console.error(`Certificate auto-generation failed for enrollment ${enrollmentId}:`, err.message);
            });

            return updated;
        }

        // ── ৪. NOT_STARTED → IN_PROGRESS ──
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
        if (courseId) where.courseId = courseId;

        if (user?.level === 'PLATFORM_ADMIN') {
            // no filter
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee must have a tenant');
            where.course = { tenantId };
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
            // no filter
        } else if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee user must have a tenant');
            where.tenantId = tenantId;
        } else if (user?.tenantId) {
            where.tenantId = user.tenantId;
        }

        return prisma.course.findUnique({
            where,
            select: { id: true, isActive: true, validityDays: true, slug: true, tenantId: true },
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
    async getLicenseeAllEnrollments(queryParams = {}, user = null) {
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
                        select: {
                            id: true,
                            slug: true,
                            courseTitle: true,
                            format: true,
                            price: true,
                            thumbnailUrl: true,
                            isActive: true,
                            tenantId: true,
                            createdById: true,
                            createdBy: {
                                select: {
                                    id: true,
                                    email: true,
                                    firstName: true,
                                    lastName: true,
                                },
                            },
                        },
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
                    progress,
                    courseSummary: {
                        title: enrollment.course.courseTitle,
                        format: enrollment.course.format,
                        isActive: enrollment.course.isActive,
                    },
                    userSummary: {
                        name: `${enrollment.user.firstName || ''} ${enrollment.user.lastName || ''}`.trim(),
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
        const courseWhere = tenantId ? { tenantId } : {};

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



    async getLicenseeStudents(queryParams = {}, user = null) {
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
            select: { userId: true },
            distinct: ['userId'],
            orderBy: { createdAt: 'desc' },
        });

        const allStudentIds = allEnrollmentsForCount.map(e => e.userId);
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
                    select: { id: true, email: true, firstName: true, lastName: true, level: true, companyName: true },
                },
                course: {
                    select: { id: true, slug: true, courseTitle: true, format: true, thumbnailUrl: true },
                },
                certificate: {
                    select: { id: true, status: true, issuedAt: true, pdfUrl: true },
                },
                lessonProgress: {
                    select: { lessonId: true, completed: true, scormStatus: true, timeSpentSecs: true },
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
                studentMap.set(uid, { user: enrollment.user, enrollments: [] });
            }

            const totalLessons = lessonCountMap.get(enrollment.courseId) ?? 0;
            const completedLessons = enrollment.lessonProgress.filter(p => {
                if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
                return p.completed === true;
            }).length;
            const totalTime = enrollment.lessonProgress.reduce((s, p) => s + (p.timeSpentSecs ?? 0), 0);

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
                course: {
                    id: enrollment.course.id,
                    slug: enrollment.course.slug,
                    courseTitle: enrollment.course.courseTitle,
                    format: enrollment.course.format,
                    thumbnailUrl: enrollment.course.thumbnailUrl,
                },
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
                        quizTitle: a.quiz?.quizTitle,
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

    async getLicenseeStudentDetail(studentId, user = null) {
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
                    include: {
                        lessons: {
                            orderBy: { orderIndex: 'asc' },
                            select: {
                                id: true, title: true, orderIndex: true,
                                contentType: true, durationSecs: true,
                                isRequired: true, isLocked: true,
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
                    select: { id: true, eventType: true, occurredAt: true, lessonId: true },
                },
            },
        });

        if (enrollments.length === 0 && user.level === 'LICENSE_USER') {
            throw new Error('Student not found in your tenant courses');
        }

        const progressMap = p => {
            const isScorm = ['SCORM', 'SCORM_12'].includes(p.lesson?.contentType);
            const done = isScorm
                ? ['COMPLETED', 'PASSED'].includes(p.scormStatus)
                : p.completed === true;
            return {
                lessonId: p.lessonId,
                lessonTitle: p.lesson?.title,
                orderIndex: p.lesson?.orderIndex,
                contentType: p.lesson?.contentType,
                isScorm,
                completed: done,
                scormStatus: isScorm ? (p.scormStatus ?? 'NOT_ATTEMPTED') : null,
                scormScore: isScorm ? p.scormScore : null,
                timeSpentSecs: p.timeSpentSecs ?? 0,
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
                    id: enrollment.course.id,
                    slug: enrollment.course.slug,
                    courseTitle: enrollment.course.courseTitle,
                    format: enrollment.course.format,
                    thumbnailUrl: enrollment.course.thumbnailUrl,
                    totalLessons,
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
                    totalEvents: enrollment.antiCheatLogs?.length ?? 0,
                    recent: enrollment.antiCheatLogs ?? [],
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
            student,
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
}

export const enrollmentService = new EnrollmentService();