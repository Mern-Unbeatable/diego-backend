import { prisma } from '../../config/db.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { addYears } from 'date-fns';
import { emailService } from '../../shared/services/emails/emailService.js';
import { config } from '../../config/config.js';
import { certificateService } from '../certificate/certificate.service.js';
import {
    formatCertificateAccess,
    userHasArchiveAccess,
} from '../certificate/certificate.archive.js';
import { credentialDeliveryService } from '../credential/credentialDelivery.service.js';

class EmployeeService {

    async _reserveSpecificPurchaseSeat(tx, { companyCoursePurchaseId, companyId, courseId = null }) {
        const purchase = await tx.companyCoursePurchase.findUnique({
            where: { id: companyCoursePurchaseId },
            select: {
                id: true,
                companyId: true,
                courseId: true,
                seatsTotal: true,
                seatsUsed: true,
                expiresAt: true,
            },
        });

        if (!purchase) throw new Error('Corporate purchase not found');
        if (purchase.companyId !== companyId) throw new Error('This corporate purchase does not belong to your company');
        if (courseId && purchase.courseId !== courseId) {
            throw new Error('Selected course does not match the corporate purchase');
        }
        if (purchase.expiresAt < new Date()) throw new Error('This corporate purchase has expired. Please renew first.');
        if (purchase.seatsUsed >= purchase.seatsTotal) {
            throw new Error(`No seats available. All ${purchase.seatsTotal} seats are used.`);
        }

        const updated = await tx.companyCoursePurchase.updateMany({
            where: {
                id: purchase.id,
                seatsUsed: purchase.seatsUsed,
            },
            data: { seatsUsed: { increment: 1 } },
        });

        if (updated.count === 0) {
            throw new Error('Seat allocation conflict. Please retry.');
        }

        return purchase;
    }

    async _reserveAnyPurchaseSeat(tx, { companyId, courseId }) {
        const purchases = await tx.companyCoursePurchase.findMany({
            where: {
                companyId,
                courseId,
                expiresAt: { gt: new Date() },
            },
            orderBy: [{ expiresAt: 'asc' }, { purchasedAt: 'asc' }],
            select: {
                id: true,
                companyId: true,
                courseId: true,
                seatsTotal: true,
                seatsUsed: true,
                expiresAt: true,
            },
        });

        for (const purchase of purchases) {
            const updated = await tx.companyCoursePurchase.updateMany({
                where: {
                    id: purchase.id,
                    seatsUsed: purchase.seatsUsed,
                },
                data: { seatsUsed: { increment: 1 } },
            });

            if (updated.count === 1) {
                return purchase;
            }
        }

        throw new Error('No active corporate seats are available for one or more selected courses');
    }

    async _resolveCompanyId(user) {
        if (user.companyId) return user.companyId;
        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { companyId: true },
        });
        if (!dbUser?.companyId) throw new Error('You are not associated with any company');
        return dbUser.companyId;
    }

    _buildEnrollmentUserSearchConditions(term) {
        if (!term?.trim()) return [];
        const search = term.trim();
        return [
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { firstName: { contains: search, mode: 'insensitive' } } },
            { user: { lastName: { contains: search, mode: 'insensitive' } } },
        ];
    }

    _buildEnrollmentCourseSearchConditions(term) {
        if (!term?.trim()) return [];
        const search = term.trim();
        return [
            { course: { courseTitle: { path: ['it'], string_contains: search } } },
            { course: { courseTitle: { path: ['en'], string_contains: search } } },
            { course: { courseTitle: { path: ['fr'], string_contains: search } } },
            { course: { courseTitle: { path: ['zh'], string_contains: search } } },
            { course: { slug: { contains: search, mode: 'insensitive' } } },
        ];
    }

    _applyEnrollmentSearchFilters(where, queryParams = {}) {
        const searchGroups = [];

        if (queryParams.search?.trim()) {
            searchGroups.push({
                OR: [
                    ...this._buildEnrollmentUserSearchConditions(queryParams.search),
                    ...this._buildEnrollmentCourseSearchConditions(queryParams.search),
                ],
            });
        } else {
            if (queryParams.employeeName?.trim()) {
                searchGroups.push({ OR: this._buildEnrollmentUserSearchConditions(queryParams.employeeName) });
            }
            if (queryParams.courseName?.trim()) {
                searchGroups.push({ OR: this._buildEnrollmentCourseSearchConditions(queryParams.courseName) });
            }
        }

        if (searchGroups.length === 1) {
            where.AND = [...(where.AND ?? []), searchGroups[0]];
        } else if (searchGroups.length > 1) {
            where.AND = [...(where.AND ?? []), ...searchGroups];
        }

        return where;
    }

    _buildCertificateUserSearchConditions(term) {
        return this._buildEnrollmentUserSearchConditions(term);
    }

    _buildCertificateCourseSearchConditions(term) {
        return this._buildEnrollmentCourseSearchConditions(term);
    }

    _applyEmployeeCertificateSearchFilters(where, queryParams = {}) {
        const searchGroups = [];

        if (queryParams.search?.trim()) {
            searchGroups.push({
                OR: [
                    ...this._buildCertificateCourseSearchConditions(queryParams.search),
                ],
            });
        } else if (queryParams.courseName?.trim()) {
            searchGroups.push({ OR: this._buildCertificateCourseSearchConditions(queryParams.courseName) });
        }

        if (searchGroups.length > 0) {
            where.AND = [...(where.AND ?? []), ...searchGroups];
        }

        return where;
    }

    _formatCourseTitle(courseTitle) {
        if (!courseTitle) return 'Course';
        if (typeof courseTitle === 'string') return courseTitle;
        return courseTitle.en || courseTitle.it || Object.values(courseTitle)[0] || 'Course';
    }

    _mapAssignedCourse(enrollments = []) {
        if (!enrollments.length) {
            return {
                courseId: null,
                courseTitle: null,
                assignedCourse: null,
            };
        }

        const primary = enrollments[0];
        const course = primary.course ?? primary;
        const title = this._formatCourseTitle(course.courseTitle);

        return {
            courseId: course.id,
            courseTitle: title,
            assignedCourse: {
                enrollmentId: primary.id ?? null,
                courseId: course.id,
                title,
                slug: course.slug ?? null,
                status: primary.status ?? null,
            },
        };
    }

    _mapEmployeeRecord(employee, user, enrollments = []) {
        const assigned = this._mapAssignedCourse(enrollments);

        return {
            id: employee.id,
            userId: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            contactNumber: user.contactNumber,
            birthDate: user.birthDate,
            city: user.city,
            traineeTaxCode: user.traineeTaxCode,
            jobTitle: employee.jobTitle,
            role: employee.jobTitle,
            employmentDate: employee.employmentDate,
            isActive: user.isActive,
            status: user.status,
            state: user.status === 'ACTIVE' ? 'Active' : user.status === 'SUSPENDED' ? 'Suspended' : user.status,
            courseId: assigned.courseId,
            courseTitle: assigned.courseTitle,
            assignedCourse: assigned.assignedCourse,
            joinedAt: employee.createdAt,
        };
    }

    async _assignCoursesToUser(tx, {
        userId,
        companyId,
        courseIds = [],
        companyCoursePurchaseId = null,
        tenantId = null,
    }) {
        if (!courseIds.length && !companyCoursePurchaseId) return [];

        let courses = [];
        if (courseIds.length > 0) {
            courses = await tx.course.findMany({
                where: {
                    id: { in: courseIds },
                    isActive: true,
                    ...(tenantId && { tenantId }),
                },
                select: { id: true, courseTitle: true, validityDays: true, slug: true },
            });

            if (courses.length !== courseIds.length) {
                throw new Error('Some courses are invalid or not active');
            }
        }

        const existingEnrollments = courseIds.length > 0
            ? await tx.enrollment.findMany({
                where: { userId, courseId: { in: courseIds } },
                select: { courseId: true },
            })
            : [];
        const alreadyEnrolled = new Set(existingEnrollments.map((e) => e.courseId));

        const enrollments = [];

        if (companyCoursePurchaseId) {
            const selectedCourseId = courses[0]?.id || null;
            const purchase = await this._reserveSpecificPurchaseSeat(tx, {
                companyCoursePurchaseId,
                companyId,
                courseId: selectedCourseId,
            });

            const duplicateEnrollment = await tx.enrollment.findUnique({
                where: { userId_courseId: { userId, courseId: purchase.courseId } },
                select: { id: true },
            });
            if (duplicateEnrollment || alreadyEnrolled.has(purchase.courseId)) {
                throw new Error('Employee is already enrolled in this course');
            }

            let selectedCourse = courses[0];
            if (!selectedCourse) {
                selectedCourse = await tx.course.findUnique({
                    where: { id: purchase.courseId },
                    select: { id: true, courseTitle: true, validityDays: true, slug: true, tenantId: true, isActive: true },
                });
                if (!selectedCourse?.isActive) throw new Error('Course for this corporate purchase is not active');
                if (tenantId && selectedCourse.tenantId !== tenantId) {
                    throw new Error('Course tenant mismatch for this purchase');
                }
            }

            const enrollment = await tx.enrollment.create({
                data: {
                    userId,
                    courseId: selectedCourse.id,
                    companyCoursePurchaseId: purchase.id,
                    companyContextId: companyId,
                    expiresAt: purchase.expiresAt,
                    status: 'NOT_STARTED',
                    accessLinkToken: randomBytes(24).toString('hex'),
                    accessLinkExpiresAt: purchase.expiresAt,
                    accessLinkUsed: false,
                },
                include: { course: { select: { id: true, courseTitle: true, slug: true } } },
            });
            enrollments.push(enrollment);
            return enrollments;
        }

        for (const course of courses) {
            if (alreadyEnrolled.has(course.id)) continue;

            const purchase = await this._reserveAnyPurchaseSeat(tx, { companyId, courseId: course.id });
            const enrollment = await tx.enrollment.create({
                data: {
                    userId,
                    courseId: course.id,
                    companyCoursePurchaseId: purchase.id,
                    companyContextId: companyId,
                    expiresAt: purchase.expiresAt,
                    status: 'NOT_STARTED',
                    accessLinkToken: randomBytes(24).toString('hex'),
                    accessLinkExpiresAt: purchase.expiresAt,
                    accessLinkUsed: false,
                },
                include: { course: { select: { id: true, courseTitle: true, slug: true } } },
            });
            enrollments.push(enrollment);
        }

        if (courseIds.length > 0 && enrollments.length === 0) {
            throw new Error('Employee is already enrolled in the selected course(s)');
        }

        return enrollments;
    }

    async getCompanyCourses(adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const [enrollmentGroups, purchases, adminProfile] = await Promise.all([
            prisma.enrollment.groupBy({
                by: ['courseId'],
                where: {
                    companyContextId: companyId,
                    user: { companyId, level: 'COMPANY_EMPLOYEE' },
                },
                _count: { _all: true },
            }),
            prisma.companyCoursePurchase.findMany({
                where: { companyId },
                orderBy: { purchasedAt: 'desc' },
                include: {
                    course: {
                        select: {
                            id: true,
                            courseTitle: true,
                            slug: true,
                            thumbnailUrl: true,
                            isActive: true,
                        },
                    },
                },
            }),
            prisma.user.findUnique({
                where: { id: adminUser.id },
                select: { firstName: true, lastName: true },
            }),
        ]);

        const enrolledByCourse = new Map(
            enrollmentGroups.map((group) => [group.courseId, group._count._all]),
        );
        const courseMap = new Map();

        for (const purchase of purchases) {
            const course = purchase.course;
            if (!course?.isActive) continue;

            if (!courseMap.has(course.id)) {
                courseMap.set(course.id, {
                    courseId: course.id,
                    courseTitle: this._formatCourseTitle(course.courseTitle),
                    slug: course.slug,
                    thumbnailUrl: course.thumbnailUrl,
                    enrolledEmployees: enrolledByCourse.get(course.id) ?? 0,
                    companyCoursePurchaseId: purchase.id,
                    seatsTotal: 0,
                    seatsUsed: 0,
                    seatsAvailable: 0,
                });
            }

            const entry = courseMap.get(course.id);
            entry.seatsTotal += purchase.seatsTotal;
            entry.seatsUsed += purchase.seatsUsed;
            entry.seatsAvailable += Math.max(0, purchase.seatsTotal - purchase.seatsUsed);
            if (purchase.seatsUsed < purchase.seatsTotal) {
                entry.companyCoursePurchaseId = purchase.id;
            }
        }

        for (const [courseId, enrolledEmployees] of enrolledByCourse) {
            if (courseMap.has(courseId)) {
                courseMap.get(courseId).enrolledEmployees = enrolledEmployees;
                continue;
            }

            const course = await prisma.course.findUnique({
                where: { id: courseId },
                select: {
                    id: true,
                    courseTitle: true,
                    slug: true,
                    thumbnailUrl: true,
                    isActive: true,
                },
            });
            if (!course?.isActive) continue;

            courseMap.set(courseId, {
                courseId: course.id,
                courseTitle: this._formatCourseTitle(course.courseTitle),
                slug: course.slug,
                thumbnailUrl: course.thumbnailUrl,
                enrolledEmployees,
                companyCoursePurchaseId: null,
                seatsTotal: 0,
                seatsUsed: 0,
                seatsAvailable: 0,
            });
        }

        return {
            adminName: `${adminProfile?.firstName || ''} ${adminProfile?.lastName || ''}`.trim(),
            courses: [...courseMap.values()].sort((a, b) => a.courseTitle.localeCompare(b.courseTitle)),
        };
    }

    async sendEnrollmentReminder(enrollmentId, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const enrollment = await prisma.enrollment.findFirst({
            where: {
                id: enrollmentId,
                companyContextId: companyId,
                user: { companyId, level: 'COMPANY_EMPLOYEE' },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                course: { select: { courseTitle: true } },
            },
        });

        if (!enrollment) throw new Error('Enrollment not found for your company');
        if (enrollment.status === 'COMPLETED') throw new Error('This employee has already completed the course');

        const courseTitle = this._formatCourseTitle(enrollment.course.courseTitle);
        const userName = `${enrollment.user.firstName || ''} ${enrollment.user.lastName || ''}`.trim()
            || enrollment.user.email;

        await emailService.sendInactiveUserReminder({
            to: enrollment.user.email,
            userName,
            courseTitle,
        });

        return {
            sent: true,
            enrollmentId,
            employeeUserId: enrollment.user.id,
            email: enrollment.user.email,
            courseTitle,
        };
    }

    async getAssignableCourses(adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const purchases = await prisma.companyCoursePurchase.findMany({
            where: {
                companyId,
                expiresAt: { gt: new Date() },
            },
            orderBy: [{ expiresAt: 'asc' }, { purchasedAt: 'asc' }],
            include: {
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                        slug: true,
                        category: true,
                        thumbnailUrl: true,
                        isActive: true,
                    },
                },
            },
        });

        return purchases
            .filter((p) => p.seatsUsed < p.seatsTotal && p.course?.isActive)
            .map((p) => ({
                companyCoursePurchaseId: p.id,
                courseId: p.courseId,
                courseTitle: p.course.courseTitle,
                slug: p.course.slug,
                category: p.course.category,
                thumbnailUrl: p.course.thumbnailUrl,
                seatsTotal: p.seatsTotal,
                seatsUsed: p.seatsUsed,
                seatsAvailable: p.seatsTotal - p.seatsUsed,
                expiresAt: p.expiresAt,
            }));
    }

    async addEmployee(data, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true },
        });
        if (!company) throw new Error('Company not found');

        // Email duplicate check
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email },
            select: { id: true },
        });
        if (existingUser) throw new Error('A user with this email already exists');


        const adminFull = await prisma.user.findUnique({
            where: { id: adminUser.id },
            select: { tenantId: true },
        });

        const requestedCourseIds = data.courseIds ?? [];
        let courses = [];
        if (requestedCourseIds.length > 0) {
            courses = await prisma.course.findMany({
                where: {
                    id: { in: requestedCourseIds },
                    isActive: true,
                    ...(adminFull?.tenantId && { tenantId: adminFull.tenantId }),
                },
                select: { id: true, courseTitle: true, validityDays: true, slug: true },
            });

            if (courses.length !== requestedCourseIds.length) {
                throw new Error('Some courses are invalid or not active');
            }
        }

        // Password
        const plainPassword = data.password || this._generatePassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);


        const result = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    contactNumber: data.contactNumber ?? null,
                    birthDate: data.birthDate ?? null,
                    city: data.city ?? null,
                    traineeTaxCode: data.traineeTaxCode ?? null,
                    level: 'COMPANY_EMPLOYEE',
                    status: data.status ?? 'ACTIVE',
                    isVerified: true,
                    isActive: (data.status ?? 'ACTIVE') === 'ACTIVE',
                    verifiedAt: new Date(),
                    profileCompleted: true,
                    consentGiven: true,
                    consentDate: new Date(),
                    companyId: companyId,
                    tenantId: adminFull?.tenantId ?? null,
                },
            });

            const employee = await tx.employee.create({
                data: {
                    userId: newUser.id,
                    companyId: companyId,
                    jobTitle: data.jobTitle ?? data.role ?? null,
                    employmentDate: data.employmentDate,
                },
            });

            const enrollments = await this._assignCoursesToUser(tx, {
                userId: newUser.id,
                companyId,
                courseIds: requestedCourseIds,
                companyCoursePurchaseId: data.companyCoursePurchaseId ?? null,
                tenantId: adminFull?.tenantId ?? null,
            });

            return { user: newUser, employee, enrollments };
        });

        const courseList = result.enrollments.map((e) => ({
            title: this._formatCourseTitle(e.course.courseTitle),
            slug: e.course.slug,
        }));

        let emailSent = false;
        try {
            const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
            const accessCourses = result.enrollments
                .filter((e) => e.accessLinkToken && baseClientUrl)
                .map((e) => ({
                    title: this._formatCourseTitle(e.course.courseTitle),
                    accessUrl: `${baseClientUrl}/enrollments/access/${e.accessLinkToken}`,
                    expiresAt: e.accessLinkExpiresAt,
                }));

            await emailService.sendEmployeeWelcomeEmail({
                to: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email,
                password: plainPassword,
                companyName: company.name,
                courses: courseList,
                accessCourses,
                role: data.jobTitle ?? data.role ?? null,
                employmentDate: data.employmentDate ?? result.employee.employmentDate,
            });
            emailSent = true;
        } catch (_emailErr) {
            emailSent = false;
        }

        if (result.enrollments.length > 0) {
            await credentialDeliveryService.recordForEnrollments({
                enrollments: result.enrollments.map((enrollment) => ({
                    ...enrollment,
                    userId: result.user.id,
                })),
                assignedBy: adminUser,
                username: data.email,
                temporaryPassword: plainPassword,
            }).catch(() => { });
        }

        return {
            employee: this._mapEmployeeRecord(result.employee, result.user, result.enrollments),
            enrollments: result.enrollments,
            assignedCoursesCount: result.enrollments.length,
            credentials: {
                email: data.email,
                temporaryPassword: plainPassword,
            },
            emailSent,
        };
    }

    async getCompanyEmployees(queryParams = {}, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const userWhere = {
            companyId,
            level: 'COMPANY_EMPLOYEE',
        };

        if (queryParams.search) {
            userWhere.OR = [
                { email: { contains: queryParams.search, mode: 'insensitive' } },
                { firstName: { contains: queryParams.search, mode: 'insensitive' } },
                { lastName: { contains: queryParams.search, mode: 'insensitive' } },
            ];
        }

        if (queryParams.status) {
            userWhere.status = queryParams.status;
        }

        const employeeOrderBy = queryParams.sortBy === 'employmentDate'
            ? { employmentDate: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' }
            : queryParams.sortBy === 'firstName' || queryParams.sortBy === 'lastName'
                ? { user: { [queryParams.sortBy]: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' } }
                : { createdAt: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };

        const employeeWhere = { companyId, user: userWhere };

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where: employeeWhere,
                orderBy: employeeOrderBy,
                skip,
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            contactNumber: true,
                            birthDate: true,
                            city: true,
                            traineeTaxCode: true,
                            isActive: true,
                            status: true,
                            createdAt: true,
                            enrollments: {
                                select: {
                                    id: true,
                                    status: true,
                                    expiresAt: true,
                                    completedAt: true,
                                    course: {
                                        select: {
                                            id: true,
                                            courseTitle: true,
                                            slug: true,
                                            thumbnailUrl: true,
                                        },
                                    },
                                    certificate: {
                                        select: {
                                            id: true,
                                            status: true,
                                            issuedAt: true,
                                            pdfUrl: true,
                                        },
                                    },
                                },
                            },
                            _count: {
                                select: {
                                    enrollments: true,
                                    certificates: true,
                                },
                            },
                        },
                    },
                },
            }),
            prisma.employee.count({ where: employeeWhere }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            employees: employees.map((emp) => ({
                ...this._mapEmployeeRecord(emp, emp.user, emp.user.enrollments),
                stats: {
                    totalEnrollments: emp.user._count.enrollments,
                    totalCertificates: emp.user._count.certificates,
                    completedCourses: emp.user.enrollments.filter((e) => e.status === 'COMPLETED').length,
                    inProgressCourses: emp.user.enrollments.filter((e) => e.status === 'IN_PROGRESS').length,
                },
                enrollments: emp.user.enrollments,
            })),
        };
    }

    async getEmployeeDetail(employeeUserId, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        contactNumber: true,
                        birthDate: true,
                        city: true,
                        traineeTaxCode: true,
                        isActive: true,
                        status: true,
                        createdAt: true,
                        enrollments: {
                            include: {
                                course: {
                                    include: {
                                        lessons: {
                                            orderBy: { orderIndex: 'asc' },
                                            select: {
                                                id: true,
                                                title: true,
                                                orderIndex: true,
                                                contentType: true,
                                                isRequired: true,
                                            },
                                        },
                                    },
                                },
                                lessonProgress: {
                                    select: {
                                        lessonId: true,
                                        completed: true,
                                        scormStatus: true,
                                        timeSpentSecs: true,
                                        completedAt: true,
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
                                        qrCode: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!employee) throw new Error('Employee not found in your company');

        const courseDetails = employee.user.enrollments.map(enrollment => this._buildEnrollmentProgress(enrollment));
        const summary = this._buildEmployeeSummary(employee.user.enrollments);

        return {
            employee: {
                ...this._mapEmployeeRecord(employee, employee.user, employee.user.enrollments),
                assignedCourses: employee.user.enrollments.map((e) => ({
                    enrollmentId: e.id,
                    courseId: e.course.id,
                    courseTitle: this._formatCourseTitle(e.course.courseTitle),
                    slug: e.course.slug,
                    status: e.status,
                    expiresAt: e.expiresAt,
                })),
            },
            summary,
            courses: courseDetails,
        };
    }

    async updateEmployee(employeeUserId, data, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        tenantId: true,
                    },
                },
                company: { select: { name: true } },
            },
        });
        if (!employee) throw new Error('Employee not found in your company');

        let plainPassword = null;
        if (data.password) {
            plainPassword = data.password;
        }

        const result = await prisma.$transaction(async (tx) => {
            const employeeUpdateData = {};
            if (data.jobTitle !== undefined || data.role !== undefined) {
                employeeUpdateData.jobTitle = data.jobTitle ?? data.role;
            }
            if (data.employmentDate !== undefined) employeeUpdateData.employmentDate = data.employmentDate;

            if (Object.keys(employeeUpdateData).length > 0) {
                await tx.employee.update({
                    where: { id: employee.id },
                    data: employeeUpdateData,
                });
            }

            const userUpdateData = {};
            if (data.firstName !== undefined) userUpdateData.firstName = data.firstName;
            if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;
            if (data.contactNumber !== undefined) userUpdateData.contactNumber = data.contactNumber;
            if (data.birthDate !== undefined) userUpdateData.birthDate = data.birthDate;
            if (data.city !== undefined) userUpdateData.city = data.city;
            if (data.traineeTaxCode !== undefined) userUpdateData.traineeTaxCode = data.traineeTaxCode;

            if (data.status !== undefined) {
                userUpdateData.status = data.status;
                userUpdateData.isActive = data.status === 'ACTIVE';
            } else if (data.isActive !== undefined) {
                userUpdateData.isActive = data.isActive;
                userUpdateData.status = data.isActive ? 'ACTIVE' : 'SUSPENDED';
            }

            if (plainPassword) {
                userUpdateData.password = await bcrypt.hash(plainPassword, 10);
            }

            if (Object.keys(userUpdateData).length > 0) {
                await tx.user.update({
                    where: { id: employee.userId },
                    data: userUpdateData,
                });
            }

            const newEnrollments = await this._assignCoursesToUser(tx, {
                userId: employee.userId,
                companyId,
                courseIds: data.courseIds ?? [],
                companyCoursePurchaseId: data.companyCoursePurchaseId ?? null,
                tenantId: employee.user.tenantId,
            });

            const updatedEmployee = await tx.employee.findUnique({
                where: { id: employee.id },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            contactNumber: true,
                            birthDate: true,
                            city: true,
                            traineeTaxCode: true,
                            isActive: true,
                            status: true,
                            enrollments: {
                                select: {
                                    id: true,
                                    status: true,
                                    course: {
                                        select: {
                                            id: true,
                                            courseTitle: true,
                                            slug: true,
                                        },
                                    },
                                },
                                orderBy: { createdAt: 'desc' },
                            },
                        },
                    },
                },
            });

            return { updatedEmployee, newEnrollments };
        });

        let emailSent = false;
        try {
            if (plainPassword || (result.newEnrollments?.length > 0)) {
                const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
                const accessCourses = (result.newEnrollments || [])
                    .filter((e) => e.accessLinkToken && baseClientUrl)
                    .map((e) => ({
                        title: this._formatCourseTitle(e.course.courseTitle),
                        accessUrl: `${baseClientUrl}/enrollments/access/${e.accessLinkToken}`,
                        expiresAt: e.accessLinkExpiresAt,
                    }));

                await emailService.sendEmployeeUpdatedEmail({
                    to: employee.user.email,
                    firstName: result.updatedEmployee.user.firstName,
                    lastName: result.updatedEmployee.user.lastName,
                    companyName: employee.company.name,
                    password: plainPassword,
                    courses: (result.newEnrollments || []).map((e) => ({
                        title: this._formatCourseTitle(e.course.courseTitle),
                        slug: e.course.slug,
                    })),
                    accessCourses,
                });
                emailSent = true;
            }
        } catch (_emailErr) {
            emailSent = false;
        }

        if (result.newEnrollments?.length > 0) {
            await credentialDeliveryService.recordForEnrollments({
                enrollments: result.newEnrollments.map((enrollment) => ({
                    ...enrollment,
                    userId: employee.userId,
                })),
                assignedBy: adminUser,
                username: employee.user.email,
                temporaryPassword: plainPassword,
            }).catch(() => { });
        }

        return {
            employee: this._mapEmployeeRecord(
                result.updatedEmployee,
                result.updatedEmployee.user,
                result.updatedEmployee.user.enrollments,
            ),
            newEnrollments: result.newEnrollments,
            assignedCoursesCount: result.newEnrollments.length,
            passwordUpdated: Boolean(plainPassword),
            emailSent,
        };
    }

    async _assertEmployeeInCompany(employeeUserId, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);
        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        contactNumber: true,
                        birthDate: true,
                        city: true,
                        traineeTaxCode: true,
                        isActive: true,
                        status: true,
                        tenantId: true,
                        createdAt: true,
                    },
                },
                company: { select: { id: true, name: true } },
            },
        });
        if (!employee) throw new Error('Employee not found in your company');
        return employee;
    }

    _buildEnrollmentProgress(enrollment) {
        const lessons = enrollment.course?.lessons ?? [];
        const totalLessons = lessons.length;
        const completedLessons = (enrollment.lessonProgress ?? []).filter((p) => {
            if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
            return p.completed === true;
        }).length;
        const totalTime = (enrollment.lessonProgress ?? []).reduce((s, p) => s + (p.timeSpentSecs ?? 0), 0);

        const quizByType = {};
        for (const attempt of enrollment.quizAttempts ?? []) {
            const type = attempt.quiz?.quizType ?? 'UNKNOWN';
            if (!quizByType[type]) quizByType[type] = { attempts: [], bestScore: 0, passed: false };
            quizByType[type].attempts.push({
                id: attempt.id,
                scorePercent: attempt.scorePercent,
                passed: attempt.passed,
                attemptedAt: attempt.attemptedAt,
            });
            if (attempt.scorePercent > quizByType[type].bestScore) {
                quizByType[type].bestScore = attempt.scorePercent;
                quizByType[type].passed = attempt.passed;
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
                courseTitle: enrollment.course.courseTitle,
                slug: enrollment.course.slug,
                thumbnailUrl: enrollment.course.thumbnailUrl ?? null,
                totalLessons,
            },
            progress: {
                totalLessons,
                completedLessons,
                percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                totalTimeSpentSecs: totalTime,
            },
            quizzes: { byType: quizByType, totalAttempts: (enrollment.quizAttempts ?? []).length },
            certificate: enrollment.certificate ?? null,
        };
    }

    async _formatCertificateForCompanyAdmin(certificate, adminUser) {
        const hasArchive = await userHasArchiveAccess(certificate.userId);
        const access = formatCertificateAccess(certificate, hasArchive);
        const companyCanDownload = certificate.status === 'ISSUED';

        return {
            id: certificate.id,
            enrollmentId: certificate.enrollmentId,
            courseId: certificate.courseId,
            status: certificate.status,
            issuedAt: certificate.issuedAt,
            downloadableUntil: certificate.downloadableUntil,
            pdfUrl: companyCanDownload ? certificate.pdfUrl : null,
            qrCode: certificate.qrCode,
            downloadCount: certificate.downloadCount,
            lastDownloadedAt: certificate.lastDownloadedAt,
            course: certificate.course
                ? {
                    id: certificate.course.id,
                    title: this._formatCourseTitle(certificate.course.courseTitle),
                    slug: certificate.course.slug,
                }
                : null,
            download: {
                ...access,
                canDownload: companyCanDownload,
                downloadStatus: companyCanDownload ? 'AVAILABLE' : access.downloadStatus,
                companyAdminCanDownload: companyCanDownload,
            },
            downloadEndpoint: companyCanDownload
                ? `/api/v1/employees/${certificate.userId}/certificates/${certificate.id}/download`
                : null,
        };
    }

    _buildEmployeeSummary(enrollments = []) {
        const totalEnrollments = enrollments.length;
        const completedCourses = enrollments.filter((e) => e.status === 'COMPLETED').length;
        const inProgressCourses = enrollments.filter((e) => e.status === 'IN_PROGRESS').length;
        const notStartedCourses = enrollments.filter((e) => e.status === 'NOT_STARTED').length;
        const certificatesEarned = enrollments.filter((e) => e.certificate?.status === 'ISSUED').length;

        const progressValues = enrollments.map((e) => {
            const lessons = e.course?.lessons ?? [];
            const totalLessons = lessons.length;
            if (!totalLessons) return 0;
            const completedLessons = (e.lessonProgress ?? []).filter((p) => {
                if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
                return p.completed === true;
            }).length;
            return Math.round((completedLessons / totalLessons) * 100);
        });

        const averageProgress = totalEnrollments > 0
            ? Math.round(progressValues.reduce((s, v) => s + v, 0) / totalEnrollments)
            : 0;

        return {
            totalEnrollments,
            completedCourses,
            inProgressCourses,
            notStartedCourses,
            certificatesEarned,
            averageProgress,
        };
    }

    async getCompanyOverview(adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);
        const now = new Date();
        const expiringSoonDate = new Date(now);
        expiringSoonDate.setDate(expiringSoonDate.getDate() + 14);

        const employeeUserIds = await prisma.user.findMany({
            where: { companyId, level: 'COMPANY_EMPLOYEE' },
            select: { id: true, status: true, isActive: true },
        });

        const userIds = employeeUserIds.map((u) => u.id);

        const [
            totalEmployees,
            activeEmployees,
            suspendedEmployees,
            enrollmentStatusBreakdown,
            totalCertificates,
            expiringSoon,
            recentCompletions,
            purchaseSeats,
        ] = await Promise.all([
            prisma.employee.count({ where: { companyId } }),
            prisma.user.count({ where: { companyId, level: 'COMPANY_EMPLOYEE', status: 'ACTIVE', isActive: true } }),
            prisma.user.count({ where: { companyId, level: 'COMPANY_EMPLOYEE', status: 'SUSPENDED' } }),
            userIds.length
                ? prisma.enrollment.groupBy({
                    by: ['status'],
                    where: { userId: { in: userIds } },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            userIds.length
                ? prisma.certificate.count({ where: { userId: { in: userIds }, status: 'ISSUED' } })
                : Promise.resolve(0),
            userIds.length
                ? prisma.enrollment.count({
                    where: {
                        userId: { in: userIds },
                        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                        expiresAt: { gte: now, lte: expiringSoonDate },
                    },
                })
                : Promise.resolve(0),
            userIds.length
                ? prisma.enrollment.findMany({
                    where: { userId: { in: userIds }, status: 'COMPLETED' },
                    orderBy: { completedAt: 'desc' },
                    take: 5,
                    include: {
                        user: { select: { id: true, firstName: true, lastName: true, email: true } },
                        course: { select: { id: true, courseTitle: true, slug: true } },
                    },
                })
                : Promise.resolve([]),
            prisma.companyCoursePurchase.findMany({
                where: { companyId, expiresAt: { gt: now } },
                select: { seatsTotal: true, seatsUsed: true },
            }),
        ]);

        const seatsAvailable = purchaseSeats.reduce((sum, p) => sum + (p.seatsTotal - p.seatsUsed), 0);
        const seatsTotal = purchaseSeats.reduce((sum, p) => sum + p.seatsTotal, 0);
        const seatsUsed = purchaseSeats.reduce((sum, p) => sum + p.seatsUsed, 0);

        return {
            companyId,
            stats: {
                totalEmployees,
                activeEmployees,
                suspendedEmployees,
                totalEnrollments: enrollmentStatusBreakdown.reduce((s, r) => s + r._count._all, 0),
                totalCertificates,
                expiringSoonEnrollments: expiringSoon,
                seatsTotal,
                seatsUsed,
                seatsAvailable,
                enrollmentStatusBreakdown: enrollmentStatusBreakdown.reduce((acc, row) => {
                    acc[row.status] = row._count._all;
                    return acc;
                }, {}),
            },
            recentCompletions: recentCompletions.map((e) => ({
                enrollmentId: e.id,
                completedAt: e.completedAt,
                employee: {
                    userId: e.user.id,
                    name: `${e.user.firstName || ''} ${e.user.lastName || ''}`.trim() || e.user.email,
                    email: e.user.email,
                },
                course: {
                    id: e.course.id,
                    title: this._formatCourseTitle(e.course.courseTitle),
                    slug: e.course.slug,
                },
            })),
        };
    }

    _mapProgressState(status) {
        if (status === 'COMPLETED') return 'completed';
        if (status === 'IN_PROGRESS') return 'in progress';
        return 'not started';
    }

    _mapProgressStateLabel(status) {
        if (status === 'COMPLETED') return 'Completato';
        if (status === 'IN_PROGRESS') return 'In corso';
        return 'Non iniziato';
    }

    _resolveLastAccess(enrollment, lessonProgress = []) {
        const dates = [
            enrollment.updatedAt,
            enrollment.startedAt,
            ...lessonProgress.map((p) => p.completedAt || p.startedAt),
        ].filter(Boolean).map((d) => new Date(d).getTime());

        return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
    }

    _computeProgressPercent(totalLessons, lessonProgress = []) {
        if (!totalLessons) return 0;
        const completed = lessonProgress.filter((p) => {
            if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
            return p.completed === true;
        }).length;
        return Math.round((completed / totalLessons) * 100);
    }

    async getProgressReport(queryParams = {}, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {
            companyContextId: companyId,
            user: { companyId, level: 'COMPANY_EMPLOYEE' },
        };

        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.userId) where.userId = queryParams.userId;

        this._applyEnrollmentSearchFilters(where, queryParams);

        const orderBy = {
            [queryParams.sortBy || 'updatedAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [enrollments, total] = await Promise.all([
            prisma.enrollment.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                    course: {
                        select: {
                            id: true,
                            courseTitle: true,
                            _count: { select: { lessons: true } },
                        },
                    },
                    lessonProgress: {
                        select: {
                            completed: true,
                            scormStatus: true,
                            startedAt: true,
                            completedAt: true,
                        },
                    },
                    certificate: { select: { id: true, status: true } },
                },
            }),
            prisma.enrollment.count({ where }),
        ]);

        const report = enrollments.map((e) => {
            const totalLessons = e.course._count.lessons;
            const progress = this._computeProgressPercent(totalLessons, e.lessonProgress);
            const hasCertificate = e.certificate?.status === 'ISSUED';

            return {
                enrollmentId: e.id,
                courseId: e.course.id,
                courseTitle: this._formatCourseTitle(e.course.courseTitle),
                employeeUserId: e.user.id,
                employeeName: `${e.user.firstName || ''} ${e.user.lastName || ''}`.trim() || e.user.email,
                state: this._mapProgressState(e.status),
                statusLabel: this._mapProgressStateLabel(e.status),
                progress,
                enrolledAt: e.createdAt,
                lastAccess: this._resolveLastAccess(e, e.lessonProgress),
                certificateId: hasCertificate ? e.certificate.id : null,
                canDownload: hasCertificate,
                canSendReminder: ['NOT_STARTED', 'IN_PROGRESS'].includes(e.status),
            };
        });

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            report,
        };
    }

    async getCompanyEnrollments(queryParams = {}, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {
            companyContextId: companyId,
            user: {
                companyId,
                level: 'COMPANY_EMPLOYEE',
            },
        };

        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.userId) where.userId = queryParams.userId;

        this._applyEnrollmentSearchFilters(where, queryParams);

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const enrollmentInclude = {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    contactNumber: true,
                    status: true,
                    isActive: true,
                },
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
                            isRequired: true,
                        },
                    },
                },
            },
            lessonProgress: {
                select: {
                    lessonId: true,
                    completed: true,
                    scormStatus: true,
                    timeSpentSecs: true,
                    completedAt: true,
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
                    qrCode: true,
                    downloadableUntil: true,
                },
            },
        };

        const [enrollments, total] = await Promise.all([
            prisma.enrollment.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: enrollmentInclude,
            }),
            prisma.enrollment.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            appliedFilters: {
                search: queryParams.search ?? null,
                employeeName: queryParams.employeeName ?? null,
                courseName: queryParams.courseName ?? null,
                status: queryParams.status ?? null,
                courseId: queryParams.courseId ?? null,
                userId: queryParams.userId ?? null,
            },
            enrollments: enrollments.map((enrollment) => ({
                ...this._buildEnrollmentProgress(enrollment),
                employee: {
                    userId: enrollment.user.id,
                    email: enrollment.user.email,
                    firstName: enrollment.user.firstName,
                    lastName: enrollment.user.lastName,
                    fullName: `${enrollment.user.firstName || ''} ${enrollment.user.lastName || ''}`.trim() || enrollment.user.email,
                    status: enrollment.user.status,
                    isActive: enrollment.user.isActive,
                },
            })),
        };
    }

    async getEmployeeEnrollments(employeeUserId, queryParams = {}, adminUser) {
        await this._assertEmployeeInCompany(employeeUserId, adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { userId: employeeUserId };
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.courseId) where.courseId = queryParams.courseId;

        this._applyEnrollmentSearchFilters(where, queryParams);

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
                    course: {
                        include: {
                            lessons: {
                                orderBy: { orderIndex: 'asc' },
                                select: {
                                    id: true,
                                    title: true,
                                    orderIndex: true,
                                    contentType: true,
                                    isRequired: true,
                                },
                            },
                        },
                    },
                    lessonProgress: {
                        select: {
                            lessonId: true,
                            completed: true,
                            scormStatus: true,
                            timeSpentSecs: true,
                            completedAt: true,
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
                            qrCode: true,
                            downloadableUntil: true,
                        },
                    },
                },
            }),
            prisma.enrollment.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            appliedFilters: {
                search: queryParams.search ?? null,
                employeeName: queryParams.employeeName ?? null,
                courseName: queryParams.courseName ?? null,
                status: queryParams.status ?? null,
                courseId: queryParams.courseId ?? null,
            },
            enrollments: enrollments.map((e) => this._buildEnrollmentProgress(e)),
        };
    }

    async getEmployeeEnrollmentDetail(employeeUserId, enrollmentId, adminUser) {
        await this._assertEmployeeInCompany(employeeUserId, adminUser);

        const enrollment = await prisma.enrollment.findFirst({
            where: { id: enrollmentId, userId: employeeUserId },
            include: {
                course: {
                    include: {
                        lessons: {
                            orderBy: { orderIndex: 'asc' },
                            select: {
                                id: true,
                                title: true,
                                orderIndex: true,
                                contentType: true,
                                isRequired: true,
                                durationSecs: true,
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
                        qrCode: true,
                        downloadableUntil: true,
                    },
                },
            },
        });

        if (!enrollment) throw new Error('Enrollment not found for this employee');

        const base = this._buildEnrollmentProgress(enrollment);
        const progressMap = new Map((enrollment.lessonProgress ?? []).map((p) => [p.lessonId, p]));

        return {
            ...base,
            lessons: (enrollment.course.lessons ?? []).map((lesson) => {
                const p = progressMap.get(lesson.id);
                const isScorm = ['SCORM', 'SCORM_12'].includes(lesson.contentType);
                const isCompleted = isScorm
                    ? ['COMPLETED', 'PASSED'].includes(p?.scormStatus)
                    : (p?.completed ?? false);

                return {
                    id: lesson.id,
                    title: this._formatCourseTitle(lesson.title),
                    orderIndex: lesson.orderIndex,
                    contentType: lesson.contentType,
                    isRequired: lesson.isRequired,
                    durationSecs: lesson.durationSecs,
                    isCompleted,
                    scormStatus: isScorm ? (p?.scormStatus ?? 'NOT_ATTEMPTED') : null,
                    timeSpentSecs: p?.timeSpentSecs ?? 0,
                    completedAt: p?.completedAt ?? null,
                };
            }),
        };
    }

    async assignCoursesToEmployee(employeeUserId, data, adminUser) {
        const employee = await this._assertEmployeeInCompany(employeeUserId, adminUser);
        const companyId = employee.companyId;

        const result = await prisma.$transaction(async (tx) => {
            const newEnrollments = await this._assignCoursesToUser(tx, {
                userId: employee.userId,
                companyId,
                courseIds: data.courseIds ?? [],
                companyCoursePurchaseId: data.companyCoursePurchaseId ?? null,
                tenantId: employee.user.tenantId,
            });

            const updatedEmployee = await tx.employee.findUnique({
                where: { id: employee.id },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            contactNumber: true,
                            birthDate: true,
                            city: true,
                            traineeTaxCode: true,
                            isActive: true,
                            status: true,
                            enrollments: {
                                select: {
                                    id: true,
                                    status: true,
                                    course: {
                                        select: { id: true, courseTitle: true, slug: true },
                                    },
                                },
                                orderBy: { createdAt: 'desc' },
                            },
                        },
                    },
                },
            });

            return { updatedEmployee, newEnrollments };
        });

        let emailSent = false;
        try {
            if (result.newEnrollments?.length > 0) {
                const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
                const accessCourses = result.newEnrollments
                    .filter((e) => e.accessLinkToken && baseClientUrl)
                    .map((e) => ({
                        title: this._formatCourseTitle(e.course.courseTitle),
                        accessUrl: `${baseClientUrl}/enrollments/access/${e.accessLinkToken}`,
                        expiresAt: e.accessLinkExpiresAt,
                    }));

                await emailService.sendEmployeeUpdatedEmail({
                    to: employee.user.email,
                    firstName: result.updatedEmployee.user.firstName,
                    lastName: result.updatedEmployee.user.lastName,
                    companyName: employee.company.name,
                    password: null,
                    courses: result.newEnrollments.map((e) => ({
                        title: this._formatCourseTitle(e.course.courseTitle),
                        slug: e.course.slug,
                    })),
                    accessCourses,
                });
                emailSent = true;
            }
        } catch (_emailErr) {
            emailSent = false;
        }

        if (result.newEnrollments?.length > 0) {
            await credentialDeliveryService.recordForEnrollments({
                enrollments: result.newEnrollments.map((enrollment) => ({
                    ...enrollment,
                    userId: employee.userId,
                })),
                assignedBy: adminUser,
                username: employee.user.email,
                temporaryPassword: null,
            }).catch(() => { });
        }

        return {
            employee: this._mapEmployeeRecord(
                result.updatedEmployee,
                result.updatedEmployee.user,
                result.updatedEmployee.user.enrollments,
            ),
            newEnrollments: result.newEnrollments,
            assignedCoursesCount: result.newEnrollments.length,
            emailSent,
        };
    }

    async getEmployeeCertificates(employeeUserId, queryParams = {}, adminUser) {
        await this._assertEmployeeInCompany(employeeUserId, adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId: employeeUserId };
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.year) {
            const year = parseInt(queryParams.year, 10);
            where.issuedAt = {
                gte: new Date(`${year}-01-01`),
                lt: new Date(`${year + 1}-01-01`),
            };
        }

        this._applyEmployeeCertificateSearchFilters(where, queryParams);

        const [certificates, total] = await Promise.all([
            prisma.certificate.findMany({
                where,
                orderBy: { issuedAt: 'desc' },
                skip,
                take: limit,
                include: {
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    enrollment: { select: { id: true, status: true, completedAt: true } },
                },
            }),
            prisma.certificate.count({ where }),
        ]);

        const formatted = await Promise.all(
            certificates.map((cert) => this._formatCertificateForCompanyAdmin(cert, adminUser)),
        );

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            appliedFilters: {
                search: queryParams.search ?? null,
                courseName: queryParams.courseName ?? null,
                courseId: queryParams.courseId ?? null,
                status: queryParams.status ?? null,
                year: queryParams.year ?? null,
            },
            certificates: formatted,
        };
    }

    async getCompanyCertificates(queryParams = {}, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = {
            user: {
                companyId,
                level: 'COMPANY_EMPLOYEE',
            },
        };

        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.year) {
            const year = parseInt(queryParams.year, 10);
            where.issuedAt = {
                gte: new Date(`${year}-01-01`),
                lt: new Date(`${year + 1}-01-01`),
            };
        }

        if (queryParams.search?.trim()) {
            where.AND = [
                ...(where.AND ?? []),
                {
                    OR: [
                        ...this._buildCertificateUserSearchConditions(queryParams.search),
                        ...this._buildCertificateCourseSearchConditions(queryParams.search),
                    ],
                },
            ];
        } else {
            const searchGroups = [];
            if (queryParams.employeeName?.trim()) {
                searchGroups.push({ OR: this._buildCertificateUserSearchConditions(queryParams.employeeName) });
            }
            if (queryParams.courseName?.trim()) {
                searchGroups.push({ OR: this._buildCertificateCourseSearchConditions(queryParams.courseName) });
            }
            if (searchGroups.length > 0) {
                where.AND = [...(where.AND ?? []), ...searchGroups];
            }
        }

        const [certificates, total] = await Promise.all([
            prisma.certificate.findMany({
                where,
                orderBy: { issuedAt: 'desc' },
                skip,
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    enrollment: { select: { id: true, status: true, completedAt: true } },
                },
            }),
            prisma.certificate.count({ where }),
        ]);

        const formatted = await Promise.all(
            certificates.map((cert) => this._formatCertificateForCompanyAdmin(cert, adminUser)),
        );

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            appliedFilters: {
                search: queryParams.search ?? null,
                employeeName: queryParams.employeeName ?? null,
                courseName: queryParams.courseName ?? null,
                userId: queryParams.userId ?? null,
                courseId: queryParams.courseId ?? null,
                status: queryParams.status ?? null,
                year: queryParams.year ?? null,
            },
            certificates: formatted.map((cert, index) => ({
                ...cert,
                employee: {
                    userId: certificates[index].user.id,
                    email: certificates[index].user.email,
                    firstName: certificates[index].user.firstName,
                    lastName: certificates[index].user.lastName,
                    fullName: `${certificates[index].user.firstName || ''} ${certificates[index].user.lastName || ''}`.trim()
                        || certificates[index].user.email,
                },
            })),
        };
    }

    async downloadEmployeeCertificate(employeeUserId, certificateId, adminUser) {
        await this._assertEmployeeInCompany(employeeUserId, adminUser);

        const certificate = await prisma.certificate.findFirst({
            where: { id: certificateId, userId: employeeUserId },
            select: { id: true },
        });
        if (!certificate) throw new Error('Certificate not found for this employee');

        return certificateService.downloadCertificate(certificateId, adminUser);
    }

    async removeEmployee(employeeUserId, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            select: { id: true, userId: true },
        });
        if (!employee) throw new Error('Employee not found in your company');

        await prisma.user.update({
            where: { id: employee.userId },
            data: { isActive: false, status: 'SUSPENDED' },
        });

        return { success: true, message: 'Employee suspended successfully' };
    }

    async removeEmployeePermanent(employeeUserId, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            include: {
                user: {
                    include: {
                        enrollments: {
                            include: {
                                certificate: true,
                                quizAttempts: true,
                                lessonProgress: true,
                                scormSessions: true,
                                antiCheatLogs: true,
                            },
                        },
                    },
                },
            },
        });
        if (!employee) throw new Error('Employee not found in your company');

        const activeEnrollments = employee.user.enrollments.filter(
            e => e.status === 'IN_PROGRESS' || e.status === 'NOT_STARTED'
        );
        if (activeEnrollments.length > 0) {
            throw new Error(`Cannot permanently remove employee. They have ${activeEnrollments.length} active course(s). Please suspend first.`);
        }

        const enrollmentsCount = employee.user.enrollments.length;
        const certificatesCount = employee.user.enrollments.filter(e => e.certificate).length;
        const quizAttemptsCount = employee.user.enrollments.reduce((a, e) => a + e.quizAttempts.length, 0);
        const lessonProgressCount = employee.user.enrollments.reduce((a, e) => a + e.lessonProgress.length, 0);

        await prisma.$transaction(async (tx) => {
            const { isWithinRetentionPeriod } = await import('../../shared/services/retention.service.js');

            for (const enrollment of employee.user.enrollments) {
                const logs = await tx.antiCheatLog.findMany({
                    where: { enrollmentId: enrollment.id },
                    select: { id: true, retentionUntil: true, occurredAt: true },
                });
                const protectedLogs = logs.filter((log) =>
                    isWithinRetentionPeriod(log.retentionUntil || addYears(log.occurredAt, 5)),
                );
                if (protectedLogs.length > 0) {
                    throw new Error(
                        `Cannot permanently remove employee: ${protectedLogs.length} anti-cheat log(s) are within the 5-year legal retention period`,
                    );
                }
                await tx.antiCheatLog.deleteMany({ where: { enrollmentId: enrollment.id } });
                await tx.scormSession.deleteMany({ where: { enrollmentId: enrollment.id } });
                await tx.quizAttempt.deleteMany({ where: { enrollmentId: enrollment.id } });
                await tx.lessonProgress.deleteMany({ where: { enrollmentId: enrollment.id } });
                if (enrollment.certificate) {
                    await tx.certificate.delete({ where: { id: enrollment.certificate.id } });
                }
            }
            await tx.enrollment.deleteMany({ where: { userId: employee.userId } });
            await tx.employee.delete({ where: { id: employee.id } });
            await tx.user.delete({ where: { id: employee.userId } });
        });

        return {
            success: true,
            message: 'Employee permanently removed from the system',
            data: {
                userId: employeeUserId,
                email: employee.user.email,
                deletedData: {
                    enrollments: enrollmentsCount,
                    certificates: certificatesCount,
                    quizAttempts: quizAttemptsCount,
                    lessonProgress: lessonProgressCount,
                },
            },
        };
    }

    _generatePassword() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let pass = '';
        for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
        return pass + '!1';
    }
}

export const employeeService = new EmployeeService();