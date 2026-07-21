import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { addDays } from 'date-fns';

export class AssignCourseService {

    async getAllAssignments(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.companyId) where.companyId = queryParams.companyId;
        if (queryParams.assignedById) where.assignedById = queryParams.assignedById;

        // Permission filtering
        const userLevel = user?.level;
        const userId = user?.id;

        if (userLevel === 'PRIVATE_USER') {
            where.userId = userId;
        } else if (userLevel === 'COMPANY_ADMIN' || userLevel === 'COMPANY_EMPLOYEE') {
            const companyUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { companyId: true },
            });
            if (companyUser?.companyId) {
                where.companyId = companyUser.companyId;
            }
        } else if (userLevel === 'LICENSE_USER') {
            const licenseeUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { tenantId: true },
            });
            if (licenseeUser?.tenantId) {
                const tenantUsers = await prisma.user.findMany({
                    where: { tenantId: licenseeUser.tenantId },
                    select: { id: true },
                });
                where.userId = { in: tenantUsers.map(u => u.id) };
            }
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [assignments, total] = await Promise.all([
            prisma.assignCourse.findMany({
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
                            companyId: true,
                        },
                    },
                    course: {
                        select: {
                            id: true,
                            courseTitle: true,
                            slug: true,
                            thumbnailUrl: true,
                        },
                    },
                    assignedBy: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    company: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),
            prisma.assignCourse.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            assignments: assignments.map(assignment => ({
                id: assignment.id,
                user: {
                    id: assignment.user.id,
                    email: assignment.user.email,
                    name: `${assignment.user.firstName || ''} ${assignment.user.lastName || ''}`.trim(),
                    level: assignment.user.level,
                },
                course: {
                    id: assignment.course.id,
                    title: localizeObject(assignment.course.courseTitle, locale),
                    slug: assignment.course.slug,
                    thumbnailUrl: assignment.course.thumbnailUrl,
                },
                assignedBy: assignment.assignedBy
                    ? {
                        id: assignment.assignedBy.id,
                        name: `${assignment.assignedBy.firstName || ''} ${assignment.assignedBy.lastName || ''}`.trim(),
                    }
                    : null,
                company: assignment.company
                    ? { id: assignment.company.id, name: assignment.company.name }
                    : null,
                dueDate: assignment.dueDate,
                createdAt: assignment.createdAt,
                updatedAt: assignment.updatedAt,
            })),
        };
    }
    async getUserAssignments(userId, locale = 'it', user = null) {
        const userLevel = user?.level;
        const requestingUserId = user?.id;

        if (userLevel === 'PRIVATE_USER' && requestingUserId !== userId) {
            throw new Error('Permission denied: You can only view your own assignments');
        }

        const assignments = await prisma.assignCourse.findMany({
            where: { userId },
            include: {
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                        slug: true,
                        thumbnailUrl: true,
                        description: true,
                        price: true,
                    },
                },
                assignedBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                company: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const courseIds = assignments.map(a => a.courseId);
        const enrollments = await prisma.enrollment.findMany({
            where: { userId, courseId: { in: courseIds } },
            select: { courseId: true, id: true, status: true, completedAt: true },
        });
        const enrollmentMap = new Map(enrollments.map(e => [e.courseId, e]));

        return assignments.map(assignment => ({
            id: assignment.id,
            course: {
                id: assignment.course.id,
                title: localizeObject(assignment.course.courseTitle, locale),
                slug: assignment.course.slug,
                thumbnailUrl: assignment.course.thumbnailUrl,
                description: localizeObject(assignment.course.description, locale),
                price: assignment.course.price,
            },
            assignedBy: assignment.assignedBy
                ? {
                    name: `${assignment.assignedBy.firstName || ''} ${assignment.assignedBy.lastName || ''}`.trim(),
                    email: assignment.assignedBy.email,
                }
                : null,
            company: assignment.company
                ? { id: assignment.company.id, name: assignment.company.name }
                : null,
            dueDate: assignment.dueDate,
            createdAt: assignment.createdAt,
            enrollment: enrollmentMap.has(assignment.courseId)
                ? {
                    enrollmentId: enrollmentMap.get(assignment.courseId).id,
                    status: enrollmentMap.get(assignment.courseId).status,
                    completedAt: enrollmentMap.get(assignment.courseId).completedAt,
                }
                : null,
        }));
    }


    async assignCourse(data, assignedById) {
        const { userId, courseId, companyId, dueDate } = data;

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, level: true, tenantId: true, companyId: true },
        });
        if (!targetUser) throw new Error('User not found');


        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, isActive: true, tenantId: true, validityDays: true },
        });
        if (!course) throw new Error('Course not found');
        if (!course.isActive) throw new Error('Course is not active');


        if (companyId) {
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { id: true },
            });
            if (!company) throw new Error('Company not found');
        }


        const existingAssignment = await prisma.assignCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true },
        });
        if (existingAssignment) {
            throw new Error('This course is already assigned to this user');
        }

        const result = await prisma.$transaction(async (tx) => {

            const assignment = await tx.assignCourse.create({
                data: {
                    userId,
                    courseId,
                    assignedById,
                    companyId: companyId || targetUser.companyId || null,
                    dueDate: dueDate || null,
                },
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true },
                    },
                    course: {
                        select: { id: true, courseTitle: true, slug: true },
                    },
                    assignedBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    company: {
                        select: { id: true, name: true },
                    },
                },
            });


            const existingEnrollment = await tx.enrollment.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true, status: true },
            });

            let enrollment = null;

            if (existingEnrollment) {
                enrollment = existingEnrollment;
            } else {

                const expiresAt = dueDate
                    ? new Date(dueDate)
                    : addDays(new Date(), course.validityDays || 90);

                enrollment = await tx.enrollment.create({
                    data: {
                        userId,
                        courseId,
                        companyContextId: companyId || targetUser.companyId || null,
                        expiresAt,
                        status: 'NOT_STARTED',
                    },
                    select: { id: true, status: true, expiresAt: true },
                });
            }

            return { assignment, enrollment };
        });

        return {
            ...result.assignment,
            enrollment: result.enrollment,
        };
    }


    async bulkAssignCourse(data, assignedById) {
        const { userIds, courseId, companyId, dueDate } = data;

        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, isActive: true, validityDays: true },
        });
        if (!course) throw new Error('Course not found');
        if (!course.isActive) throw new Error('Course is not active');
        const existingAssignments = await prisma.assignCourse.findMany({
            where: { userId: { in: userIds }, courseId },
            select: { userId: true },
        });
        const alreadyAssignedIds = new Set(existingAssignments.map(a => a.userId));

        const newUserIds = userIds.filter(id => !alreadyAssignedIds.has(id));

        if (newUserIds.length === 0) {
            throw new Error('All selected users already have this course assigned');
        }

        const existingEnrollments = await prisma.enrollment.findMany({
            where: { userId: { in: newUserIds }, courseId },
            select: { userId: true },
        });
        const alreadyEnrolledIds = new Set(existingEnrollments.map(e => e.userId));


        const expiresAt = dueDate
            ? new Date(dueDate)
            : addDays(new Date(), course.validityDays || 90);


        const results = await prisma.$transaction(async (tx) => {
            const assignments = [];
            const enrollments = [];

            for (const userId of newUserIds) {

                const assignment = await tx.assignCourse.create({
                    data: {
                        userId,
                        courseId,
                        assignedById,
                        companyId: companyId || null,
                        dueDate: dueDate || null,
                    },
                });
                assignments.push(assignment);


                if (!alreadyEnrolledIds.has(userId)) {
                    const enrollment = await tx.enrollment.create({
                        data: {
                            userId,
                            courseId,
                            companyContextId: companyId || null,
                            expiresAt,
                            status: 'NOT_STARTED',
                        },
                        select: { id: true, userId: true, status: true },
                    });
                    enrollments.push(enrollment);
                }
            }

            return { assignments, enrollments };
        });

        return {
            totalRequested: userIds.length,
            alreadyAssigned: alreadyAssignedIds.size,
            alreadyEnrolled: alreadyEnrolledIds.size,
            successfullyAssigned: results.assignments.length,
            newEnrollmentsCreated: results.enrollments.length,
            assignments: results.assignments,
            enrollments: results.enrollments,
        };
    }

    async updateAssignment(id, data, userId) {
        const { dueDate } = data;

        const existing = await prisma.assignCourse.findUnique({
            where: { id },
            select: { id: true, userId: true, courseId: true },
        });
        if (!existing) throw new Error('Assignment not found');

        await this._checkPermission(existing.userId, userId);


        const updateOps = [
            prisma.assignCourse.update({
                where: { id },
                data: { dueDate },
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true },
                    },
                    course: {
                        select: { id: true, courseTitle: true, slug: true },
                    },
                    assignedBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            }),
        ];

        if (dueDate) {
            updateOps.push(
                prisma.enrollment.updateMany({
                    where: { userId: existing.userId, courseId: existing.courseId },
                    data: { expiresAt: new Date(dueDate) },
                })
            );
        }

        const [assignment] = await prisma.$transaction(updateOps);
        return assignment;
    }

    async deleteAssignment(id, userId) {
        const existing = await prisma.assignCourse.findUnique({
            where: { id },
            select: { id: true, userId: true },
        });
        if (!existing) throw new Error('Assignment not found');

        await this._checkPermission(existing.userId, userId);

        return prisma.assignCourse.delete({
            where: { id },
            select: { id: true, userId: true, courseId: true },
        });

    }


    async _checkPermission(assignmentUserId, requestingUserId) {
        const user = await prisma.user.findUnique({
            where: { id: requestingUserId },
            select: { level: true, companyId: true, tenantId: true },
        });
        if (!user) throw new Error('User not found');

        if (user.level === 'PLATFORM_ADMIN') return;

        if (user.level === 'LICENSE_USER') {
            const assignedUser = await prisma.user.findUnique({
                where: { id: assignmentUserId },
                select: { tenantId: true },
            });
            if (assignedUser?.tenantId === user.tenantId) return;
            throw new Error('Permission denied: User is not in your tenant');
        }

        if (user.level === 'COMPANY_ADMIN') {
            const assignedUser = await prisma.user.findUnique({
                where: { id: assignmentUserId },
                select: { companyId: true },
            });
            if (assignedUser?.companyId === user.companyId) return;
            throw new Error('Permission denied: User is not in your company');
        }

        if (assignmentUserId === requestingUserId) return;

        throw new Error('Permission denied');
    }
}

export const assignCourseService = new AssignCourseService();