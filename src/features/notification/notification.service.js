import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import { emailService } from '../../shared/services/emails/emailService.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { addDays, subDays, startOfDay, endOfDay } from 'date-fns';


const log = new Logger('NotificationService');

const ENROLLMENT_REMINDER_WINDOWS = [7, 3, 1];
const CERTIFICATE_REMINDER_WINDOWS = [90, 30, 7];
const INACTIVE_AFTER_DAYS = 10;
const INACTIVE_RESEND_COOLDOWN_DAYS = 7;
const COMPANY_DIGEST_LOOKAHEAD_DAYS = 14;

class NotificationService {


    async _createNotification({ userId, type, title, message, tenantId = null }) {
        return prisma.notification.create({
            data: { userId, type, title, message, tenantId },
        });
    }

    async _createAlert({ userId, severity, message, relatedEnrollmentId = null, tenantId = null }) {
        return prisma.alert.create({
            data: { userId, severity, message, relatedEnrollmentId, tenantId },
        });
    }

    async notifyCourseAssigned({ userId, email, courses = [], courseTitle, accessUrl = null, expiresAt = null }) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, lastName: true, preferredLanguage: true, tenantId: true },
        });

        const resolvedCourseTitle = courseTitle
            || courses?.[0]?.en
            || courses?.[0]?.it
            || (typeof courses?.[0] === 'object' ? Object.values(courses[0])[0] : courses?.[0])
            || 'Course';

        await this._createNotification({
            userId,
            type: 'COURSE_ASSIGNED',
            tenantId: user?.tenantId ?? null,
            title: {
                it: 'Nuovo corso assegnato',
                en: 'New course assigned',
            },
            message: {
                it: `Ti e stato assegnato il corso "${resolvedCourseTitle}".`,
                en: `You have been assigned to "${resolvedCourseTitle}".`,
                accessUrl,
            },
        });

        if (!email) return;

        await emailService.sendEmployeeCourseAccessEmail({
            to: email,
            firstName: user?.firstName,
            lastName: user?.lastName,
            courseTitle: resolvedCourseTitle,
            accessUrl,
            expiresAt,
            isNewAccount: false,
        });
    }
    // In notification.service.js
    async getUserNotifications(userId, queryParams = {}) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { userId };
        if (queryParams.read !== undefined) where.read = queryParams.read === 'true';
        if (queryParams.type) where.type = queryParams.type;

        const [notifications, total, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where, orderBy: { createdAt: 'desc' }, skip, take: limit,
            }),
            prisma.notification.count({ where }),
            prisma.notification.count({ where: { userId, read: false } }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit), unreadCount },
            notifications,
        };
    }
    // Add this method to your NotificationService class in notification.service.js

    async runAllScheduledJobs() {
        log.info('Running all scheduled notification jobs...');

        const results = {
            enrollmentExpiry: null,
            certificateExpiry: null,
            expiredEnrollments: null,
            inactiveUsers: null,
            companyDigest: null,
            errors: []
        };

        try {
            results.enrollmentExpiry = await this.processEnrollmentExpiryReminders();
        } catch (err) {
            log.error('Enrollment expiry job failed:', err.message);
            results.errors.push({ job: 'enrollmentExpiry', error: err.message });
        }

        try {
            results.certificateExpiry = await this.processCertificateExpiryReminders();
        } catch (err) {
            log.error('Certificate expiry job failed:', err.message);
            results.errors.push({ job: 'certificateExpiry', error: err.message });
        }

        try {
            results.expiredEnrollments = await this.processExpiredEnrollments();
        } catch (err) {
            log.error('Expired enrollments job failed:', err.message);
            results.errors.push({ job: 'expiredEnrollments', error: err.message });
        }

        try {
            results.inactiveUsers = await this.processInactiveUserReminders();
        } catch (err) {
            log.error('Inactive users job failed:', err.message);
            results.errors.push({ job: 'inactiveUsers', error: err.message });
        }

        try {
            results.companyDigest = await this.processCompanyExpiryDigest();
        } catch (err) {
            log.error('Company digest job failed:', err.message);
            results.errors.push({ job: 'companyDigest', error: err.message });
        }

        log.info(`All jobs completed with ${results.errors.length} error(s)`);
        return results;
    }
    async sendEmployeeCredentials({
        email,
        firstName,
        lastName,
        tempPassword,
        courses = [],
        accessUrl = null,
        expiresAt = null,
    }) {
        const resolvedCourseTitle = courses?.[0]?.en
            || courses?.[0]?.it
            || (typeof courses?.[0] === 'object' ? Object.values(courses[0])[0] : courses?.[0])
            || 'Course';

        await emailService.sendEmployeeCourseAccessEmail({
            to: email,
            firstName,
            lastName,
            password: tempPassword,
            courseTitle: resolvedCourseTitle,
            accessUrl,
            expiresAt,
            isNewAccount: true,
        });
    }

    _fullName(user) {
        return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || 'User';
    }

    _courseTitleFor(course, locale) {
        return localizeObject(course.courseTitle, locale) || 'Course';
    }

    async _alreadyAlertedToday(enrollmentId) {
        const existing = await prisma.alert.findFirst({
            where: {
                relatedEnrollmentId: enrollmentId,
                createdAt: { gte: startOfDay(new Date()) },
            },
            select: { id: true },
        });
        return !!existing;
    }

    async processEnrollmentExpiryReminders() {
        let emailsSent = 0;
        let alertsCreated = 0;
        let skipped = 0;
        let errors = 0;

        for (const daysLeft of ENROLLMENT_REMINDER_WINDOWS) {
            const targetDate = addDays(new Date(), daysLeft);
            const windowStart = startOfDay(targetDate);
            const windowEnd = endOfDay(targetDate);

            const enrollments = await prisma.enrollment.findMany({
                where: {
                    status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                    expiresAt: { gte: windowStart, lte: windowEnd },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            preferredLanguage: true,
                            alertsOptOut: true,
                            tenantId: true,
                        },
                    },
                    course: {
                        select: { id: true, courseTitle: true, tenantId: true },
                    },
                },
            });

            for (const enrollment of enrollments) {
                try {
                    if (!enrollment.user) { skipped++; continue; }


                    if (await this._alreadyAlertedToday(enrollment.id)) { skipped++; continue; }

                    const locale = enrollment.user.preferredLanguage || 'it';
                    const courseTitle = this._courseTitleFor(enrollment.course, locale);
                    const severity = daysLeft <= 3 ? 'RED' : 'YELLOW';

                    // In-app alert (always created, regardless of email opt-out)
                    await this._createAlert({
                        userId: enrollment.user.id,
                        severity,
                        relatedEnrollmentId: enrollment.id,
                        tenantId: enrollment.user.tenantId ?? enrollment.course.tenantId ?? null,
                        message: {
                            it: `Il corso "${courseTitle}" scade tra ${daysLeft} giorno/i.`,
                            en: `The course "${courseTitle}" expires in ${daysLeft} day(s).`,
                            type: 'ENROLLMENT_EXPIRY',
                            daysLeft,
                            enrollmentId: enrollment.id,
                        },
                    });
                    alertsCreated++;


                    await this._createNotification({
                        userId: enrollment.user.id,
                        type: 'ENROLLMENT_EXPIRY',
                        tenantId: enrollment.user.tenantId ?? enrollment.course.tenantId ?? null,
                        title: {
                            it: 'Promemoria scadenza corso',
                            en: 'Course expiry reminder',
                        },
                        message: {
                            it: `Il corso "${courseTitle}" scade tra ${daysLeft} giorno/i.`,
                            en: `The course "${courseTitle}" expires in ${daysLeft} day(s).`,
                            enrollmentId: enrollment.id,
                            daysLeft,
                        },
                    });


                    if (!enrollment.user.alertsOptOut && enrollment.user.email) {
                        await emailService.sendCourseExpiryReminder({
                            to: enrollment.user.email,
                            userName: this._fullName(enrollment.user),
                            courseTitle,
                            daysLeft,
                            expiresAt: enrollment.expiresAt,
                        });
                        emailsSent++;
                    }
                } catch (err) {
                    errors++;
                    log.error(`Enrollment expiry reminder failed for enrollment=${enrollment.id}:`, err.message);
                }
            }
        }

        return { emailsSent, alertsCreated, skipped, errors };
    }


    async processExpiredEnrollments() {
        const result = await prisma.enrollment.updateMany({
            where: {
                status: { notIn: ['COMPLETED', 'EXPIRED'] },
                expiresAt: { lt: new Date() },
            },
            data: { status: 'EXPIRED' },
        });

        log.info(`Marked ${result.count} enrollment(s) as EXPIRED`);
        return { expiredCount: result.count };
    }


    async processCertificateExpiryReminders() {
        let emailsSent = 0;
        let alertsCreated = 0;
        let skipped = 0;
        let errors = 0;

        for (const daysLeft of CERTIFICATE_REMINDER_WINDOWS) {
            const targetDate = addDays(new Date(), daysLeft);
            const windowStart = startOfDay(targetDate);
            const windowEnd = endOfDay(targetDate);

            const certificates = await prisma.certificate.findMany({
                where: {
                    status: { in: ['ISSUED'] },
                    archived: false,
                    downloadableUntil: { gte: windowStart, lte: windowEnd },
                },
                include: {
                    user: {
                        select: {
                            id: true, email: true, firstName: true, lastName: true,
                            preferredLanguage: true, alertsOptOut: true, tenantId: true,
                        },
                    },
                    course: { select: { id: true, courseTitle: true, tenantId: true } },
                },
            });

            for (const certificate of certificates) {
                try {
                    if (!certificate.user) { skipped++; continue; }

                    const dedupeKey = `cert:${certificate.id}`;
                    const alreadySent = await prisma.notification.findFirst({
                        where: {
                            userId: certificate.user.id,
                            type: 'CERTIFICATE_EXPIRY',
                            createdAt: { gte: startOfDay(new Date()) },
                            message: { path: ['dedupeKey'], equals: dedupeKey },
                        },
                        select: { id: true },
                    });
                    if (alreadySent) { skipped++; continue; }

                    const locale = certificate.user.preferredLanguage || 'it';
                    const courseTitle = this._courseTitleFor(certificate.course, locale);
                    const severity = daysLeft <= 7 ? 'RED' : 'YELLOW';

                    await this._createAlert({
                        userId: certificate.user.id,
                        severity,
                        tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                        message: {
                            it: `Il certificato per "${courseTitle}" scade tra ${daysLeft} giorno/i.`,
                            en: `The certificate for "${courseTitle}" expires in ${daysLeft} day(s).`,
                            type: 'CERTIFICATE_EXPIRY',
                            daysLeft,
                            certificateId: certificate.id,
                        },
                    });
                    alertsCreated++;

                    await this._createNotification({
                        userId: certificate.user.id,
                        type: 'CERTIFICATE_EXPIRY',
                        tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                        title: {
                            it: 'Promemoria scadenza attestato',
                            en: 'Certificate expiry reminder',
                        },
                        message: {
                            it: `Il certificato per "${courseTitle}" scade tra ${daysLeft} giorno/i.`,
                            en: `The certificate for "${courseTitle}" expires in ${daysLeft} day(s).`,
                            certificateId: certificate.id,
                            daysLeft,
                            dedupeKey,
                        },
                    });

                    if (!certificate.user.alertsOptOut && certificate.user.email) {
                        await emailService.sendCertificateExpiryReminder({
                            to: certificate.user.email,
                            userName: this._fullName(certificate.user),
                            courseTitle,
                            daysLeft,
                            expiresAt: certificate.downloadableUntil,
                        });
                        emailsSent++;
                    }
                } catch (err) {
                    errors++;
                    log.error(`Certificate expiry reminder failed for certificate=${certificate.id}:`, err.message);
                }
            }
        }

        return { emailsSent, alertsCreated, skipped, errors };
    }


    async processInactiveUserReminders() {
        let emailsSent = 0;
        let skipped = 0;
        let errors = 0;

        const cutoff = subDays(new Date(), INACTIVE_AFTER_DAYS);

        const enrollments = await prisma.enrollment.findMany({
            where: {
                status: 'NOT_STARTED',
                startedAt: null,
                createdAt: { lte: cutoff },
            },
            include: {
                user: {
                    select: {
                        id: true, email: true, firstName: true, lastName: true,
                        preferredLanguage: true, alertsOptOut: true,
                    },
                },
                course: { select: { id: true, courseTitle: true } },
            },
        });

        for (const enrollment of enrollments) {
            try {
                if (!enrollment.user?.email) { skipped++; continue; }
                if (enrollment.user.alertsOptOut) { skipped++; continue; }

                // Don't re-send more often than the cooldown window
                const recentReminder = await prisma.notification.findFirst({
                    where: {
                        userId: enrollment.user.id,
                        type: 'INACTIVE_USER_REMINDER',
                        createdAt: { gte: subDays(new Date(), INACTIVE_RESEND_COOLDOWN_DAYS) },
                        message: { path: ['enrollmentId'], equals: enrollment.id },
                    },
                    select: { id: true },
                });
                if (recentReminder) { skipped++; continue; }

                const locale = enrollment.user.preferredLanguage || 'it';
                const courseTitle = this._courseTitleFor(enrollment.course, locale);

                await this._createNotification({
                    userId: enrollment.user.id,
                    type: 'INACTIVE_USER_REMINDER',
                    title: { it: 'Non hai ancora iniziato il corso', en: "You haven't started your course" },
                    message: {
                        it: `Non hai ancora iniziato "${courseTitle}".`,
                        en: `You haven't started "${courseTitle}" yet.`,
                        enrollmentId: enrollment.id,
                    },
                });

                await emailService.sendInactiveUserReminder({
                    to: enrollment.user.email,
                    userName: this._fullName(enrollment.user),
                    courseTitle,
                });
                emailsSent++;
            } catch (err) {
                errors++;
                log.error(`Inactive user reminder failed for enrollment=${enrollment.id}:`, err.message);
            }
        }

        return { emailsSent, skipped, errors };
    }

    async processCompanyExpiryDigest() {
        let digestsSent = 0;
        let errors = 0;

        const companyAdmins = await prisma.user.findMany({
            where: { level: 'COMPANY_ADMIN', isActive: true, companyId: { not: null } },
            select: {
                id: true, email: true, firstName: true, lastName: true,
                preferredLanguage: true, alertsOptOut: true, companyId: true,
            },
        });

        const lookaheadEnd = endOfDay(addDays(new Date(), COMPANY_DIGEST_LOOKAHEAD_DAYS));

        // Group admins by company to avoid recomputing the same report twice
        const adminsByCompany = new Map();
        for (const admin of companyAdmins) {
            if (!adminsByCompany.has(admin.companyId)) adminsByCompany.set(admin.companyId, []);
            adminsByCompany.get(admin.companyId).push(admin);
        }

        for (const [companyId, admins] of adminsByCompany.entries()) {
            try {
                const company = await prisma.company.findUnique({
                    where: { id: companyId },
                    select: { id: true, name: true },
                });
                if (!company) continue;

                const enrollments = await prisma.enrollment.findMany({
                    where: {
                        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                        expiresAt: { lte: lookaheadEnd, gte: new Date() },
                        OR: [
                            { companyContextId: companyId },
                            { user: { companyId } },
                        ],
                    },
                    include: {
                        user: { select: { firstName: true, lastName: true, email: true } },
                        course: { select: { courseTitle: true } },
                    },
                });

                if (enrollments.length === 0) continue;

                const courses = enrollments.map(e => ({
                    employeeName: this._fullName(e.user),
                    courseTitle: this._courseTitleFor(e.course, 'it'),
                    expiresAt: e.expiresAt,
                    daysLeft: Math.max(0, Math.ceil((e.expiresAt - new Date()) / 86400000)),
                }));

                for (const admin of admins) {
                    if (admin.alertsOptOut || !admin.email) continue;

                    await this._createNotification({
                        userId: admin.id,
                        type: 'COMPANY_EXPIRY_DIGEST',
                        title: { it: 'Report scadenze dipendenti', en: 'Employee expiry digest' },
                        message: {
                            it: `${courses.length} corso/i dei tuoi dipendenti stanno per scadere.`,
                            en: `${courses.length} of your employees' course(s) are expiring soon.`,
                            companyId,
                        },
                    });

                    await emailService.sendCompanyExpiryDigest({
                        to: admin.email,
                        companyName: company.name,
                        expiringCount: courses.length,
                        courses,
                    });
                    digestsSent++;
                }
            } catch (err) {
                errors++;
                log.error(`Company expiry digest failed for company=${companyId}:`, err.message);
            }
        }

        return { digestsSent, errors };
    }

    async deleteOldNotifications(retentionDays = 90) {
        const cutoff = subDays(new Date(), retentionDays);

        const result = await prisma.notification.deleteMany({
            where: {
                read: true,
                createdAt: { lt: cutoff },
            },
        });

        log.info(`Deleted ${result.count} old notification(s) older than ${retentionDays} days`);
        return { count: result.count };
    }


    async getMyNotifications(userId, queryParams = {}) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { userId };
        if (queryParams.read !== undefined) where.read = queryParams.read === 'true';
        if (queryParams.type) where.type = queryParams.type;

        const [notifications, total, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where, orderBy: { createdAt: 'desc' }, skip, take: limit,
            }),
            prisma.notification.count({ where }),
            prisma.notification.count({ where: { userId, read: false } }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit), unreadCount },
            notifications,
        };
    }

    async markAsRead(notificationId, userId) {
        const notification = await prisma.notification.findUnique({
            where: { id: notificationId },
            select: { id: true, userId: true },
        });
        if (!notification) throw new Error('Notification not found');
        if (notification.userId !== userId) throw new Error('Permission denied');

        return prisma.notification.update({
            where: { id: notificationId },
            data: { read: true },
        });
    }

    async markAllAsRead(userId) {
        const result = await prisma.notification.updateMany({
            where: { userId, read: false },
            data: { read: true },
        });
        return { updatedCount: result.count };
    }

    async getMyAlerts(userId, queryParams = {}) {
        const where = { userId };
        if (queryParams.dismissed !== undefined) where.dismissed = queryParams.dismissed === 'true';
        if (queryParams.severity) where.severity = queryParams.severity;

        return prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' } });
    }

    async dismissAlert(alertId, userId) {
        const alert = await prisma.alert.findUnique({
            where: { id: alertId },
            select: { id: true, userId: true },
        });
        if (!alert) throw new Error('Alert not found');
        if (alert.userId !== userId) throw new Error('Permission denied');

        return prisma.alert.update({
            where: { id: alertId },
            data: { dismissed: true },
        });
    }

    async updateAlertOptOut(userId, alertsOptOut) {
        const user = await prisma.user.update({
            where: { id: userId },
            data: { alertsOptOut },
            select: { id: true, alertsOptOut: true },
        });
        return user;
    }

    async create({ userId, type, title, message, tenantId = null }) {
        return this._createNotification({ userId, type, title, message, tenantId });
    }

    async markRead(notificationIds, userId) {
        const ids = Array.isArray(notificationIds) ? notificationIds : [notificationIds];
        return prisma.notification.updateMany({
            where: { id: { in: ids }, userId },
            data: { read: true },
        });
    }

    async markAllRead(userId) {
        return this.markAllAsRead(userId);
    }

    // NEW: certificate.service.js
    async notifyCertificateReady({ userId, courseTitle, tenantId = null, pdfUrl }) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                email: true,
                firstName: true,
                lastName: true,
                preferredLanguage: true,
                alertsOptOut: true,
            },
        });

        if (!user) {
            log.warn(`notifyCertificateReady: user ${userId} not found`);
            return null;
        }

        // In-app notification —
        await this._createNotification({
            userId,
            type: 'CERTIFICATE_READY',
            tenantId,
            title: {
                it: 'Il tuo attestato è pronto',
                en: 'Your certificate is ready',
            },
            message: {
                it: `Hai completato con successo "${courseTitle}". Il tuo attestato è ora disponibile per il download.`,
                en: `You have successfully completed "${courseTitle}". Your certificate is now available for download.`,
                pdfUrl,
            },
        });

        if (!user.alertsOptOut && user.email) {
            await emailService.sendCertificateReady({
                to: user.email,
                userName: this._fullName(user),
                courseTitle,
                downloadUrl: pdfUrl,
            });
            log.info(`Certificate-ready email sent to ${user.email} for course "${courseTitle}"`);
        } else {
            log.info(`Certificate-ready email skipped for user ${userId} (opted out or no email)`);
        }

        return { notified: true, emailSent: !user.alertsOptOut && !!user.email };
    }
}

export const notificationService = new NotificationService();