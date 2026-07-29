import cron from 'node-cron';
import { Logger } from '../../config/logger.js';
import { notificationService } from '../../features/notification/notification.service.js';

const log = new Logger('Scheduler');

//  wrapper
const safeJob = (name, fn) => async () => {
    try {
        log.info(`[CRON] Starting job: ${name}`);
        const result = await fn();
        log.info(`[CRON] Finished job: ${name}`, result);
    } catch (err) {
        log.error(`[CRON] Job "${name}" failed:`, err.message);
    }
};


cron.schedule('0 7 * * *', safeJob(
    'enrollment_expiry_reminders',
    () => notificationService.processEnrollmentExpiryReminders()
));

/**
 * Every day at 07:15 AM – Mark expired enrollments as EXPIRED
 */
cron.schedule('15 7 * * *', safeJob(
    'expire_enrollments',
    () => notificationService.processExpiredEnrollments()
));

/**
 * Every day at 07:30 AM – Certificate expiry reminders
 * Checks certificates expiring in 90, 30, 7 days
 */
cron.schedule('30 7 * * *', safeJob(
    'certificate_expiry_reminders',
    () => notificationService.processCertificateExpiryReminders()
));

/**
 * Every day at 08:00 AM – Inactive user reminders
 * Finds users who haven't started a course after 10 days
 */
cron.schedule('0 8 * * *', safeJob(
    'inactive_user_reminders',
    () => notificationService.processInactiveUserReminders()
));

/**
 * Every Monday at 08:30 AM – Company expiry digest
 * Sends weekly digest to company admins about expiring employee courses
 */
cron.schedule('30 8 * * 1', safeJob(
    'company_expiry_digest',
    () => notificationService.processCompanyExpiryDigest()
));

/**
 * Every Sunday at 02:00 AM – Cleanup old read notifications (90 days)
 */
cron.schedule('0 2 * * 0', safeJob(
    'cleanup_old_notifications',
    () => notificationService.deleteOldNotifications(90)
));

log.info('[CRON] All scheduled jobs registered');