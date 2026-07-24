import { prisma } from '../../config/db.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { notificationService } from '../notification/notification.service.js';
import { credentialDeliveryService } from '../credential/credentialDelivery.service.js';
import { Logger } from '../../config/logger.js';
import { config } from '../../config/config.js';

const log = new Logger('CompanyCoursePurchaseService');

class CompanyCoursePurchaseService {

    _buildEnrollmentAccessLink(token) {
        const baseClientUrl = (config.CLIENT_URL || '').replace(/\/$/, '');
        if (!baseClientUrl) return null;
        return `${baseClientUrl}/enrollments/access/${token}`;
    }

    async _reserveSeatOrThrow(tx, purchaseId) {
        const purchase = await tx.companyCoursePurchase.findUnique({
            where: { id: purchaseId },
            select: { id: true, seatsTotal: true, seatsUsed: true, expiresAt: true, companyId: true, courseId: true },
        });

        if (!purchase) throw new Error('Corporate purchase not found');
        if (purchase.expiresAt < new Date()) {
            throw new Error('This corporate purchase has expired. Please renew first.');
        }
        if (purchase.seatsUsed >= purchase.seatsTotal) {
            throw new Error(`No seats available. All ${purchase.seatsTotal} seats are used.`);
        }

        const reserved = await tx.companyCoursePurchase.updateMany({
            where: { id: purchaseId, seatsUsed: purchase.seatsUsed },
            data: { seatsUsed: { increment: 1 } },
        });

        if (reserved.count === 0) {
            throw new Error('Seat allocation conflict. Please retry.');
        }

        return purchase;
    }


    async getCompanyPurchases(companyId) {
        const purchases = await prisma.companyCoursePurchase.findMany({
            where: { companyId },
            orderBy: { purchasedAt: 'desc' },
            include: {
                course: { select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true, isActive: true } },
                enrollments: {
                    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
                },
            },
        });

        const now = new Date();
        return purchases.map(p => {
            const msRemaining = p.expiresAt.getTime() - now.getTime();
            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            const isExpired = msRemaining <= 0;
            const isExpiringSoon = !isExpired && daysRemaining <= 7;

            return {
                id: p.id,
                course: p.course,
                seatsTotal: p.seatsTotal,
                seatsUsed: p.enrollments.length,
                seatsAvailable: p.seatsTotal - p.enrollments.length,
                pricePerUser: p.pricePerUser,
                totalAmount: p.totalAmount,
                expiresAt: p.expiresAt,
                daysRemaining: isExpired ? 0 : daysRemaining,
                isExpired,
                isExpiringSoon,
                alertColor: isExpired ? 'RED' : isExpiringSoon ? 'YELLOW' : null,
                canRenew: p.course.isActive,
                assignedEmployees: p.enrollments.map(e => ({
                    enrollmentId: e.id,
                    userId: e.userId,
                    name: `${e.user.firstName || ''} ${e.user.lastName || ''}`.trim(),
                    email: e.user.email,
                    status: e.status,
                })),
            };
        });
    }

    async getPurchaseById(companyCoursePurchaseId, requestedByUserId) {
        const purchase = await prisma.companyCoursePurchase.findUnique({
            where: { id: companyCoursePurchaseId },
            include: {
                course: { select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true, isActive: true } },
                company: { select: { id: true, name: true } },
                enrollments: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } } },
            },
        });
        if (!purchase) throw new Error('Corporate purchase not found');

        const requester = await prisma.user.findUnique({ where: { id: requestedByUserId }, select: { companyId: true, level: true } });
        if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase.companyId) {
            throw new Error('Permission denied');
        }
        return purchase;
    }

    async assignSeat({ companyCoursePurchaseId, employeeUserId }, requestedByUserId) {
        return prisma.$transaction(async (tx) => {
            const purchase = await this._reserveSeatOrThrow(tx, companyCoursePurchaseId);

            const requester = await tx.user.findUnique({ where: { id: requestedByUserId }, select: { companyId: true, level: true } });
            if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase.companyId) {
                throw new Error('Permission denied: not your company purchase');
            }

            const employee = await tx.user.findUnique({
                where: { id: employeeUserId },
                select: { id: true, companyId: true, isActive: true, email: true, firstName: true, lastName: true },
            });
            if (!employee) throw new Error('Employee not found');
            if (employee.companyId !== purchase.companyId) throw new Error('Employee does not belong to this company');
            if (!employee.isActive) throw new Error('Employee account is not active');

            const existing = await tx.enrollment.findUnique({
                where: { userId_courseId: { userId: employeeUserId, courseId: purchase.courseId } },
                select: { id: true },
            });
            if (existing) throw new Error('This employee is already enrolled in this course');

            const enrollment = await tx.enrollment.create({
                data: {
                    userId: employeeUserId,
                    courseId: purchase.courseId,
                    companyCoursePurchaseId,
                    companyContextId: purchase.companyId,
                    expiresAt: purchase.expiresAt,
                    status: 'NOT_STARTED',
                    accessLinkToken: randomBytes(24).toString('hex'),
                    accessLinkExpiresAt: purchase.expiresAt,
                    accessLinkUsed: false,
                },
                include: {
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                },
            });

            return { employee, enrollment };
        }).then(async (result) => {
            const accessUrl = this._buildEnrollmentAccessLink(result.enrollment.accessLinkToken);
            notificationService.notifyCourseAssigned?.({
                userId: result.employee.id,
                email: result.employee.email,
                courses: [result.enrollment.course.courseTitle],
                courseTitle: result.enrollment.course.courseTitle,
                accessUrl,
                expiresAt: result.enrollment.accessLinkExpiresAt,
            }).catch(err => log.error(`Notification failed: ${err.message}`));

            const assigner = await prisma.user.findUnique({
                where: { id: requestedByUserId },
                select: { id: true, level: true },
            });
            await credentialDeliveryService.recordForEnrollments({
                enrollments: [{
                    ...result.enrollment,
                    userId: result.employee.id,
                }],
                assignedBy: assigner,
                username: result.employee.email,
                temporaryPassword: null,
            }).catch((err) => log.error(`Credential delivery failed: ${err.message}`));

            return {
                ...result,
                access: {
                    token: result.enrollment.accessLinkToken,
                    expiresAt: result.enrollment.accessLinkExpiresAt,
                    url: accessUrl,
                },
            };
        });
    }

    async bulkAssignSeats({ companyCoursePurchaseId, employeeUserIds }, requestedByUserId) {
        const results = [];
        const errors = [];
        for (const employeeUserId of employeeUserIds) {
            try {
                const result = await this.assignSeat({ companyCoursePurchaseId, employeeUserId }, requestedByUserId);
                results.push(result);
            } catch (err) {
                errors.push({ employeeUserId, error: err.message });
            }
        }
        return { successCount: results.length, failedCount: errors.length, results, errors };
    }

    async inviteAndAssignEmployee({ companyCoursePurchaseId, email, firstName, lastName, jobTitle }, requestedByUserId) {
        const createdAndAssigned = await prisma.$transaction(async (tx) => {
            const purchase = await this._reserveSeatOrThrow(tx, companyCoursePurchaseId);

            const requester = await tx.user.findUnique({ where: { id: requestedByUserId }, select: { companyId: true, level: true } });
            if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase.companyId) {
                throw new Error('Permission denied');
            }

            let user = await tx.user.findUnique({ where: { email } });
            let tempPassword = null;

            if (!user) {
                tempPassword = randomBytes(6).toString('hex');
                const hashedPassword = await bcrypt.hash(tempPassword, 10);
                user = await tx.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                        level: 'COMPANY_EMPLOYEE',
                        status: 'PENDING',
                        firstName: firstName || null,
                        lastName: lastName || null,
                        companyId: purchase.companyId,
                        isActive: true,
                    },
                });
            } else if (user.companyId !== purchase.companyId) {
                throw new Error('This email is already registered under a different account');
            }

            await tx.employee.upsert({
                where: { userId: user.id },
                update: {
                    companyId: purchase.companyId,
                    ...(jobTitle ? { jobTitle } : {}),
                },
                create: {
                    userId: user.id,
                    companyId: purchase.companyId,
                    jobTitle: jobTitle || null,
                },
            });

            const existing = await tx.enrollment.findUnique({
                where: { userId_courseId: { userId: user.id, courseId: purchase.courseId } },
                select: { id: true },
            });
            if (existing) throw new Error('This employee is already enrolled in this course');

            const enrollment = await tx.enrollment.create({
                data: {
                    userId: user.id,
                    courseId: purchase.courseId,
                    companyCoursePurchaseId,
                    companyContextId: purchase.companyId,
                    expiresAt: purchase.expiresAt,
                    status: 'NOT_STARTED',
                    accessLinkToken: randomBytes(24).toString('hex'),
                    accessLinkExpiresAt: purchase.expiresAt,
                    accessLinkUsed: false,
                },
                include: {
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                },
            });

            return { user, tempPassword, enrollment };
        });

        if (createdAndAssigned.tempPassword) {
            notificationService.sendEmployeeCredentials?.({
                email: createdAndAssigned.user.email,
                firstName: createdAndAssigned.user.firstName,
                lastName: createdAndAssigned.user.lastName,
                tempPassword: createdAndAssigned.tempPassword,
                courses: [createdAndAssigned.enrollment.course.courseTitle],
                accessUrl: this._buildEnrollmentAccessLink(createdAndAssigned.enrollment.accessLinkToken),
                expiresAt: createdAndAssigned.enrollment.accessLinkExpiresAt,
            }).catch(err => log.error(`Credential email failed: ${err.message}`));
        }

        const assigner = await prisma.user.findUnique({
            where: { id: requestedByUserId },
            select: { id: true, level: true },
        });
        await credentialDeliveryService.recordForEnrollments({
            enrollments: [{
                ...createdAndAssigned.enrollment,
                userId: createdAndAssigned.user.id,
            }],
            assignedBy: assigner,
            username: createdAndAssigned.user.email,
            temporaryPassword: createdAndAssigned.tempPassword ?? null,
        }).catch((err) => log.error(`Credential delivery failed: ${err.message}`));

        if (!createdAndAssigned.tempPassword) {
            notificationService.notifyCourseAssigned?.({
                userId: createdAndAssigned.user.id,
                email: createdAndAssigned.user.email,
                courses: [createdAndAssigned.enrollment.course.courseTitle],
                courseTitle: createdAndAssigned.enrollment.course.courseTitle,
                accessUrl: this._buildEnrollmentAccessLink(createdAndAssigned.enrollment.accessLinkToken),
                expiresAt: createdAndAssigned.enrollment.accessLinkExpiresAt,
            }).catch(err => log.error(`Notification failed: ${err.message}`));
        }

        return {
            user: {
                id: createdAndAssigned.user.id,
                email: createdAndAssigned.user.email,
                isNewAccount: !!createdAndAssigned.tempPassword,
            },
            employee: createdAndAssigned.user,
            enrollment: createdAndAssigned.enrollment,
            access: {
                token: createdAndAssigned.enrollment.accessLinkToken,
                expiresAt: createdAndAssigned.enrollment.accessLinkExpiresAt,
                url: this._buildEnrollmentAccessLink(createdAndAssigned.enrollment.accessLinkToken),
            },
        };
    }

    async revokeSeat(enrollmentId, requestedByUserId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            include: { user: { select: { companyId: true } } },
        });
        if (!enrollment) throw new Error('Enrollment not found');
        if (!enrollment.companyCoursePurchaseId) throw new Error('This enrollment is not part of a corporate purchase');
        if (enrollment.status === 'COMPLETED') throw new Error('Cannot revoke a completed enrollment');

        const requester = await prisma.user.findUnique({ where: { id: requestedByUserId }, select: { companyId: true, level: true } });
        if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== enrollment.user.companyId) {
            throw new Error('Permission denied');
        }

        await prisma.enrollment.delete({ where: { id: enrollmentId } });

        const usedSeats = await prisma.enrollment.count({ where: { companyCoursePurchaseId: enrollment.companyCoursePurchaseId } });
        await prisma.companyCoursePurchase.update({
            where: { id: enrollment.companyCoursePurchaseId },
            data: { seatsUsed: usedSeats },
        });

        return { revoked: true, enrollmentId };
    }
}

export const companyCoursePurchaseService = new CompanyCoursePurchaseService();