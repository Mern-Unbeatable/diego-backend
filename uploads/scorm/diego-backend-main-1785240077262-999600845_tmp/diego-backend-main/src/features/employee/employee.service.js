import { prisma } from '../../config/db.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { emailService } from '../../shared/services/emails/emailService.js';
import { config } from '../../config/config.js';

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

        // Admin-এর tenantId বের করো
        const adminFull = await prisma.user.findUnique({
            where: { id: adminUser.id },
            select: { tenantId: true },
        });

        const requestedCourseIds = data.courseIds || [];
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
                    status: 'ACTIVE',
                    isVerified: true,
                    isActive: true,
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
                    jobTitle: data.jobTitle ?? null,
                },
            });

            const enrollments = [];

            if (data.companyCoursePurchaseId) {
                const selectedCourseId = courses[0]?.id || null;
                const purchase = await this._reserveSpecificPurchaseSeat(tx, {
                    companyCoursePurchaseId: data.companyCoursePurchaseId,
                    companyId,
                    courseId: selectedCourseId,
                });

                let selectedCourse = courses[0];
                if (!selectedCourse) {
                    selectedCourse = await tx.course.findUnique({
                        where: { id: purchase.courseId },
                        select: { id: true, courseTitle: true, validityDays: true, slug: true, tenantId: true, isActive: true },
                    });

                    if (!selectedCourse || !selectedCourse.isActive) {
                        throw new Error('Course for this corporate purchase is not active');
                    }
                    if (adminFull?.tenantId && selectedCourse.tenantId !== adminFull.tenantId) {
                        throw new Error('Course tenant mismatch for this purchase');
                    }
                }

                const enrollment = await tx.enrollment.create({
                    data: {
                        userId: newUser.id,
                        courseId: selectedCourse.id,
                        companyCoursePurchaseId: purchase.id,
                        companyContextId: companyId,
                        expiresAt: purchase.expiresAt,
                        status: 'NOT_STARTED',
                        accessLinkToken: randomBytes(24).toString('hex'),
                        accessLinkExpiresAt: purchase.expiresAt,
                        accessLinkUsed: false,
                    },
                    include: {
                        course: { select: { id: true, courseTitle: true, slug: true } },
                    },
                });
                enrollments.push(enrollment);
            } else {
                for (const course of courses) {
                    const purchase = await this._reserveAnyPurchaseSeat(tx, { companyId, courseId: course.id });
                    const enrollment = await tx.enrollment.create({
                        data: {
                            userId: newUser.id,
                            courseId: course.id,
                            companyCoursePurchaseId: purchase.id,
                            companyContextId: companyId,
                            expiresAt: purchase.expiresAt,
                            status: 'NOT_STARTED',
                            accessLinkToken: randomBytes(24).toString('hex'),
                            accessLinkExpiresAt: purchase.expiresAt,
                            accessLinkUsed: false,
                        },
                        include: {
                            course: { select: { id: true, courseTitle: true, slug: true } },
                        },
                    });
                    enrollments.push(enrollment);
                }
            }

            return { user: newUser, employee, enrollments };
        });

        const courseList = result.enrollments.map(e => ({
            title: e.course.courseTitle?.en
                || e.course.courseTitle?.it
                || (typeof e.course.courseTitle === 'object' ? Object.values(e.course.courseTitle)[0] : e.course.courseTitle)
                || 'Course',
            slug: e.course.slug,
        }));

        if (courseList.length === 0) {
            courseList.push(...courses.map(c => ({
                title: c.courseTitle?.en
                    || c.courseTitle?.it
                    || (typeof c.courseTitle === 'object' ? Object.values(c.courseTitle)[0] : c.courseTitle)
                    || 'Course',
                slug: c.slug,
            })));
        }

        let emailSent = false;
        try {
            const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
            const accessCourses = result.enrollments
                .filter(e => e.accessLinkToken && baseClientUrl)
                .map(e => ({
                    title: e.course.courseTitle?.en
                        || e.course.courseTitle?.it
                        || (typeof e.course.courseTitle === 'object' ? Object.values(e.course.courseTitle)[0] : e.course.courseTitle)
                        || 'Course',
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
            });
            emailSent = true;
        } catch (emailErr) {

            emailSent = false;
        }

        return {
            employee: {
                id: result.employee.id,
                userId: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                contactNumber: result.user.contactNumber,
                birthDate: result.user.birthDate,
                city: result.user.city,
                traineeTaxCode: result.user.traineeTaxCode,
                jobTitle: result.employee.jobTitle,
            },
            enrollments: result.enrollments,
            assignedCoursesCount: result.enrollments.length,
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

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where: { companyId, user: userWhere },
                orderBy: { createdAt: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' },
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
            prisma.employee.count({ where: { companyId } }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            employees: employees.map(emp => ({
                id: emp.id,
                userId: emp.user.id,
                email: emp.user.email,
                firstName: emp.user.firstName,
                lastName: emp.user.lastName,
                contactNumber: emp.user.contactNumber,
                birthDate: emp.user.birthDate,
                city: emp.user.city,
                traineeTaxCode: emp.user.traineeTaxCode,
                jobTitle: emp.jobTitle,
                isActive: emp.user.isActive,
                status: emp.user.status,
                joinedAt: emp.createdAt,
                stats: {
                    totalEnrollments: emp.user._count.enrollments,
                    totalCertificates: emp.user._count.certificates,
                    completedCourses: emp.user.enrollments.filter(e => e.status === 'COMPLETED').length,
                    inProgressCourses: emp.user.enrollments.filter(e => e.status === 'IN_PROGRESS').length,
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

        const courseDetails = employee.user.enrollments.map(enrollment => {
            const totalLessons = enrollment.course.lessons.length;
            const completedLessons = enrollment.lessonProgress.filter(p => {
                if (p.scormStatus && ['COMPLETED', 'PASSED'].includes(p.scormStatus)) return true;
                return p.completed === true;
            }).length;
            const totalTime = enrollment.lessonProgress.reduce((s, p) => s + (p.timeSpentSecs ?? 0), 0);

            const quizByType = {};
            for (const attempt of enrollment.quizAttempts) {
                const type = attempt.quiz?.quizType ?? 'UNKNOWN';
                if (!quizByType[type]) quizByType[type] = { attempts: [], bestScore: 0, passed: false };
                quizByType[type].attempts.push({
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
                course: {
                    id: enrollment.course.id,
                    courseTitle: enrollment.course.courseTitle,
                    slug: enrollment.course.slug,
                    totalLessons,
                },
                progress: {
                    totalLessons,
                    completedLessons,
                    percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                    totalTimeSpentSecs: totalTime,
                },
                quizzes: { byType: quizByType, totalAttempts: enrollment.quizAttempts.length },
                certificate: enrollment.certificate ?? null,
            };
        });

        const totalCourses = courseDetails.length;
        const completedCourses = courseDetails.filter(c => c.status === 'COMPLETED').length;
        const avgProgress = totalCourses > 0
            ? Math.round(courseDetails.reduce((s, c) => s + c.progress.percentage, 0) / totalCourses)
            : 0;

        return {
            employee: {
                id: employee.id,
                userId: employee.user.id,
                email: employee.user.email,
                firstName: employee.user.firstName,
                lastName: employee.user.lastName,
                contactNumber: employee.user.contactNumber,
                birthDate: employee.user.birthDate,
                city: employee.user.city,
                traineeTaxCode: employee.user.traineeTaxCode,
                jobTitle: employee.jobTitle,
                isActive: employee.user.isActive,
                joinedAt: employee.createdAt,
            },
            summary: {
                totalCourses,
                completedCourses,
                inProgressCourses: courseDetails.filter(c => c.status === 'IN_PROGRESS').length,
                notStartedCourses: courseDetails.filter(c => c.status === 'NOT_STARTED').length,
                averageProgress: avgProgress,
                totalQuizAttempts: courseDetails.reduce((s, c) => s + c.quizzes.totalAttempts, 0),
                certificatesEarned: courseDetails.filter(c => c.certificate?.status === 'ISSUED').length,
            },
            courses: courseDetails,
        };
    }

    async updateEmployee(employeeUserId, data, adminUser) {
        const companyId = await this._resolveCompanyId(adminUser);

        const employee = await prisma.employee.findFirst({
            where: { userId: employeeUserId, companyId },
            select: { id: true, userId: true },
        });
        if (!employee) throw new Error('Employee not found in your company');

        return prisma.$transaction(async (tx) => {
            if (data.jobTitle !== undefined) {
                await tx.employee.update({
                    where: { id: employee.id },
                    data: { jobTitle: data.jobTitle },
                });
            }

            const userUpdateData = {};
            if (data.firstName !== undefined) userUpdateData.firstName = data.firstName;
            if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;
            if (data.contactNumber !== undefined) userUpdateData.contactNumber = data.contactNumber;
            if (data.birthDate !== undefined) userUpdateData.birthDate = data.birthDate;
            if (data.city !== undefined) userUpdateData.city = data.city;
            if (data.traineeTaxCode !== undefined) userUpdateData.traineeTaxCode = data.traineeTaxCode;
            if (data.isActive !== undefined) {
                userUpdateData.isActive = data.isActive;
                userUpdateData.status = data.isActive ? 'ACTIVE' : 'SUSPENDED';
            }

            if (Object.keys(userUpdateData).length > 0) {
                await tx.user.update({
                    where: { id: employee.userId },
                    data: userUpdateData,
                });
            }

            return tx.employee.findUnique({
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
                        },
                    },
                },
            });
        });
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
            for (const enrollment of employee.user.enrollments) {
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