import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import { emailService } from '../../shared/services/emails/emailService.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { addDays, subDays, startOfDay, endOfDay, differenceInCalendarDays } from 'date-fns';
import { config } from '../../config/config.js';
import {
    CERTIFICATE_FREE_DOWNLOAD_DAYS,
    CERTIFICATE_REMINDER_DAYS,
} from '../certificate/certificate.constants.js';
import { userHasArchiveAccess } from '../certificate/certificate.archive.js';

const log = new Logger('NotificationService');

/** Client: course access reminders — giallo/rosso prima della scadenza */
const ENROLLMENT_REMINDER_WINDOWS = [30, 14, 7, 3, 1];

/** Client: attestato "Disponibile per 30 gg" — promemoria prima della scadenza download */
const CERTIFICATE_REMINDER_WINDOWS = CERTIFICATE_REMINDER_DAYS;
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
            certificateDownloadExpired: null,
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
            results.certificateDownloadExpired = await this.processCertificateDownloadExpiredNotices();
        } catch (err) {
            log.error('Certificate download expired job failed:', err.message);
            results.errors.push({ job: 'certificateDownloadExpired', error: err.message });
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
                    const severity = this._severityForDaysLeft(daysLeft);

                    // In-app alert (always created, regardless of email opt-out)
                    await this._createAlert({
                        userId: enrollment.user.id,
                        severity,
                        relatedEnrollmentId: enrollment.id,
                        tenantId: enrollment.user.tenantId ?? enrollment.course.tenantId ?? null,
                        message: {
                            it: `Il corso "${courseTitle}" scade tra ${daysLeft} giorno/i. Completa la formazione prima della scadenza.`,
                            en: `The course "${courseTitle}" expires in ${daysLeft} day(s). Please complete your training before it expires.`,
                            type: 'ENROLLMENT_EXPIRY',
                            daysLeft,
                            enrollmentId: enrollment.id,
                            expiresAt: enrollment.expiresAt,
                        },
                    });
                    alertsCreated++;

                    await this._createNotification({
                        userId: enrollment.user.id,
                        type: 'ENROLLMENT_EXPIRY',
                        tenantId: enrollment.user.tenantId ?? enrollment.course.tenantId ?? null,
                        title: {
                            it: `⏳ ${daysLeft} giorni rimasti al corso`,
                            en: `⏳ ${daysLeft} days left on your course`,
                        },
                        message: {
                            it: `Il corso "${courseTitle}" scade il ${new Date(enrollment.expiresAt).toLocaleDateString('it-IT')}. Ti restano ${daysLeft} giorno/i.`,
                            en: `The course "${courseTitle}" expires on ${new Date(enrollment.expiresAt).toLocaleDateString('en-GB')}. You have ${daysLeft} day(s) left.`,
                            enrollmentId: enrollment.id,
                            daysLeft,
                            expiresAt: enrollment.expiresAt,
                            severity,
                        },
                    });


                    if (!enrollment.user.alertsOptOut && enrollment.user.email) {
                        await emailService.sendCourseExpiryReminder({
                            to: enrollment.user.email,
                            userName: this._fullName(enrollment.user),
                            courseTitle,
                            daysLeft,
                            expiresAt: enrollment.expiresAt,
                            locale: enrollment.user.preferredLanguage || 'it',
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

                    const dedupeKey = `cert:${certificate.id}:daysLeft:${daysLeft}`;
                    const alreadySent = await prisma.notification.findFirst({
                        where: {
                            userId: certificate.user.id,
                            type: 'CERTIFICATE_EXPIRY',
                            message: { path: ['dedupeKey'], equals: dedupeKey },
                        },
                        select: { id: true },
                    });
                    if (alreadySent) { skipped++; continue; }

                    const locale = certificate.user.preferredLanguage || 'it';
                    const courseTitle = this._courseTitleFor(certificate.course, locale);
                    const severity = this._severityForDaysLeft(daysLeft);
                    const archiveUrl = `${config.CLIENT_URL}/certificates/archive`;

                    await this._createAlert({
                        userId: certificate.user.id,
                        severity,
                        tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                        message: {
                            it: `L'attestato per "${courseTitle}" è disponibile per il download ancora per ${daysLeft} giorno/i. Dopo la scadenza potrai acquistare il servizio di archiviazione.`,
                            en: `The certificate for "${courseTitle}" is available for download for ${daysLeft} more day(s). After expiry you can purchase archive storage.`,
                            type: 'CERTIFICATE_EXPIRY',
                            daysLeft,
                            certificateId: certificate.id,
                            downloadableUntil: certificate.downloadableUntil,
                        },
                    });
                    alertsCreated++;

                    await this._createNotification({
                        userId: certificate.user.id,
                        type: 'CERTIFICATE_EXPIRY',
                        tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                        title: {
                            it: `📄 Disponibile per ${daysLeft} giorni`,
                            en: `📄 Available for ${daysLeft} days`,
                        },
                        message: {
                            it: `Il download dell'attestato "${courseTitle}" scade il ${new Date(certificate.downloadableUntil).toLocaleDateString('it-IT')}. Scaricalo ora o acquista l'archivio.`,
                            en: `Certificate download for "${courseTitle}" expires on ${new Date(certificate.downloadableUntil).toLocaleDateString('en-GB')}. Download now or purchase archive storage.`,
                            certificateId: certificate.id,
                            daysLeft,
                            dedupeKey,
                            downloadableUntil: certificate.downloadableUntil,
                            archiveUrl,
                            severity,
                        },
                    });

                    if (!certificate.user.alertsOptOut && certificate.user.email) {
                        await emailService.sendCertificateExpiryReminder({
                            to: certificate.user.email,
                            userName: this._fullName(certificate.user),
                            courseTitle,
                            daysLeft,
                            expiresAt: certificate.downloadableUntil,
                            archiveUrl,
                            locale,
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

    /** Notify users whose 30-day free certificate download window just ended */
    async processCertificateDownloadExpiredNotices() {
        let emailsSent = 0;
        let notificationsCreated = 0;
        let skipped = 0;
        let errors = 0;

        const yesterday = subDays(new Date(), 1);
        const windowStart = startOfDay(yesterday);
        const windowEnd = endOfDay(yesterday);

        const certificates = await prisma.certificate.findMany({
            where: {
                status: 'ISSUED',
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

                const hasArchive = await userHasArchiveAccess(certificate.user.id);
                if (hasArchive) { skipped++; continue; }

                const dedupeKey = `cert:expired:${certificate.id}`;
                const alreadySent = await prisma.notification.findFirst({
                    where: {
                        userId: certificate.user.id,
                        type: 'CERTIFICATE_DOWNLOAD_EXPIRED',
                        message: { path: ['dedupeKey'], equals: dedupeKey },
                    },
                    select: { id: true },
                });
                if (alreadySent) { skipped++; continue; }

                const locale = certificate.user.preferredLanguage || 'it';
                const courseTitle = this._courseTitleFor(certificate.course, locale);
                const archiveUrl = `${config.CLIENT_URL}/certificates/archive`;

                await prisma.certificate.update({
                    where: { id: certificate.id },
                    data: { archived: true, archivedAt: new Date() },
                });

                await this._createAlert({
                    userId: certificate.user.id,
                    severity: 'RED',
                    tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                    message: {
                        it: `Il periodo gratuito di download per "${courseTitle}" è scaduto. Acquista il servizio di archiviazione per scaricare di nuovo l'attestato.`,
                        en: `The free download period for "${courseTitle}" has ended. Purchase archive storage to download your certificate again.`,
                        type: 'CERTIFICATE_DOWNLOAD_EXPIRED',
                        certificateId: certificate.id,
                    },
                });

                await this._createNotification({
                    userId: certificate.user.id,
                    type: 'CERTIFICATE_DOWNLOAD_EXPIRED',
                    tenantId: certificate.user.tenantId ?? certificate.tenantId ?? null,
                    title: {
                        it: 'Download attestato scaduto',
                        en: 'Certificate download expired',
                    },
                    message: {
                        it: `I 30 giorni gratuiti per scaricare l'attestato "${courseTitle}" sono terminati. Acquista l'archivio attestati per accedere di nuovo al PDF.`,
                        en: `The 30 free days to download "${courseTitle}" certificate have ended. Purchase certificate archive storage to access the PDF again.`,
                        certificateId: certificate.id,
                        dedupeKey,
                        archiveUrl,
                        severity: 'RED',
                    },
                });
                notificationsCreated++;

                if (!certificate.user.alertsOptOut && certificate.user.email) {
                    await emailService.sendCertificateDownloadExpired({
                        to: certificate.user.email,
                        userName: this._fullName(certificate.user),
                        courseTitle,
                        archiveUrl,
                        locale,
                    });
                    emailsSent++;
                }
            } catch (err) {
                errors++;
                log.error(`Certificate download expired notice failed for ${certificate.id}:`, err.message);
            }
        }

        return { emailsSent, notificationsCreated, skipped, errors };
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

    _severityForDaysLeft(daysLeft) {
        if (daysLeft <= 0) return 'RED';
        if (daysLeft <= 7) return 'RED';
        if (daysLeft <= 14) return 'YELLOW';
        return 'GREEN';
    }

    _daysUntil(date) {
        if (!date) return null;
        return differenceInCalendarDays(new Date(date), new Date());
    }

    async getMyDeadlines(userId, locale = 'it') {
        const [enrollments, certificates, hasArchive] = await Promise.all([
            prisma.enrollment.findMany({
                where: {
                    userId,
                    status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                },
                select: {
                    id: true,
                    status: true,
                    expiresAt: true,
                    startedAt: true,
                    course: { select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true } },
                },
                orderBy: { expiresAt: 'asc' },
            }),
            prisma.certificate.findMany({
                where: { userId, status: 'ISSUED' },
                select: {
                    id: true,
                    issuedAt: true,
                    downloadableUntil: true,
                    archived: true,
                    course: { select: { id: true, courseTitle: true, slug: true } },
                },
                orderBy: { downloadableUntil: 'asc' },
            }),
            userHasArchiveAccess(userId),
        ]);

        const courses = enrollments.map(e => {
            const daysLeft = this._daysUntil(e.expiresAt);
            return {
                enrollmentId: e.id,
                courseId: e.course.id,
                title: localizeObject(e.course.courseTitle, locale),
                slug: e.course.slug,
                thumbnailUrl: e.course.thumbnailUrl,
                status: e.status,
                expiresAt: e.expiresAt,
                daysRemaining: daysLeft,
                severity: this._severityForDaysLeft(daysLeft ?? 0),
                label:
                    daysLeft == null
                        ? null
                        : daysLeft <= 0
                            ? (locale === 'it' ? 'Scaduto' : 'Expired')
                            : locale === 'it'
                                ? `${daysLeft} giorni rimasti`
                                : `${daysLeft} days left`,
            };
        });

        const certs = certificates.map(c => {
            const daysLeft = this._daysUntil(c.downloadableUntil);
            const canDownload = hasArchive || (daysLeft != null && daysLeft >= 0);
            return {
                certificateId: c.id,
                courseId: c.course.id,
                title: localizeObject(c.course.courseTitle, locale),
                issuedAt: c.issuedAt,
                downloadableUntil: c.downloadableUntil,
                freeDownloadDays: CERTIFICATE_FREE_DOWNLOAD_DAYS,
                daysRemaining: hasArchive ? null : Math.max(0, daysLeft ?? 0),
                severity: hasArchive ? 'GREEN' : this._severityForDaysLeft(daysLeft ?? 0),
                canDownload,
                needsArchivePurchase: !hasArchive && daysLeft != null && daysLeft < 0,
                label: hasArchive
                    ? (locale === 'it' ? 'Archivio attivo' : 'Archive active')
                    : daysLeft == null
                        ? null
                        : daysLeft <= 0
                            ? (locale === 'it' ? 'Scaduto — acquista archivio' : 'Expired — buy archive')
                            : locale === 'it'
                                ? `Disponibile per ${daysLeft} giorni`
                                : `Available for ${daysLeft} days`,
            };
        });

        const urgentCourse = courses.find(c => c.severity === 'RED') || null;
        const urgentCert = certs.find(c => c.severity === 'RED' && !c.canDownload) || certs.find(c => c.severity === 'RED') || null;

        return {
            summary: {
                activeCourses: courses.length,
                certificates: certs.length,
                hasArchiveAccess: hasArchive,
                freeCertificateDownloadDays: CERTIFICATE_FREE_DOWNLOAD_DAYS,
                mostUrgent: urgentCourse || urgentCert || null,
            },
            courses,
            certificates: certs,
        };
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

    async notifyCertificateReady({
        userId,
        courseTitle,
        tenantId = null,
        pdfUrl,
        certificateId = null,
        downloadableUntil = null,
    }) {
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

        const locale = user.preferredLanguage || 'it';
        const freeDays = CERTIFICATE_FREE_DOWNLOAD_DAYS;
        const expiryDate = downloadableUntil
            ? new Date(downloadableUntil).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB')
            : null;
        const certificatesUrl = `${config.CLIENT_URL}/certificates`;
        const archiveUrl = `${config.CLIENT_URL}/certificates/archive`;

        await this._createNotification({
            userId,
            type: 'CERTIFICATE_READY',
            tenantId,
            title: {
                it: '🎉 Il tuo attestato è pronto',
                en: '🎉 Your certificate is ready',
            },
            message: {
                it: `Hai completato "${courseTitle}". Scarica l'attestato entro ${freeDays} giorni (disponibile fino al ${expiryDate || '—'}).`,
                en: `You completed "${courseTitle}". Download your certificate within ${freeDays} days${expiryDate ? ` (until ${expiryDate})` : ''}.`,
                pdfUrl,
                certificateId,
                downloadableUntil,
                daysRemaining: freeDays,
                freeDownloadDays: freeDays,
                certificatesUrl,
                archiveUrl,
                severity: 'GREEN',
            },
        });

        await this._createAlert({
            userId,
            severity: 'GREEN',
            tenantId,
            message: {
                it: `Attestato disponibile per ${freeDays} giorni — "${courseTitle}"`,
                en: `Certificate available for ${freeDays} days — "${courseTitle}"`,
                type: 'CERTIFICATE_READY',
                certificateId,
                daysRemaining: freeDays,
            },
        });

        if (!user.alertsOptOut && user.email) {
            await emailService.sendCertificateReady({
                to: user.email,
                userName: this._fullName(user),
                courseTitle,
                downloadUrl: pdfUrl,
                certificatesUrl,
                freeDownloadDays: freeDays,
                downloadableUntil,
                locale,
            });
            log.info(`Certificate-ready email sent to ${user.email} for course "${courseTitle}"`);
        } else {
            log.info(`Certificate-ready email skipped for user ${userId} (opted out or no email)`);
        }

        return { notified: true, emailSent: !user.alertsOptOut && !!user.email };
    }
}

export const notificationService = new NotificationService();