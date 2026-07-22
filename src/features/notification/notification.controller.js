import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { notificationService } from './notification.service.js';
import {
    notificationQuerySchema,
    markReadSchema,
    deleteNotificationsSchema,
    notificationIdParamSchema,
    updateAlertOptOutSchema,
    createNotificationSchema,
    triggerJobSchema,
} from './notification.validation.js';
import { Logger } from '../../config/logger.js';

const log = new Logger('NotificationController');

class NotificationController {

    getMyDeadlines = catchAsync(async (req, res) => {
        const deadlines = await notificationService.getMyDeadlines(
            req.user.id,
            req.locale || req.user.preferredLanguage || 'it'
        );

        ResponseHandler.success(res, {
            message: 'Deadlines fetched successfully',
            data: deadlines,
        });
    });

    getMyAlerts = catchAsync(async (req, res) => {
        const alerts = await notificationService.getMyAlerts(req.user.id, req.query);

        ResponseHandler.success(res, {
            message: 'Alerts fetched successfully',
            data: { alerts },
        });
    });

    dismissAlert = catchAsync(async (req, res) => {
        const alert = await notificationService.dismissAlert(req.params.alertId, req.user.id);

        ResponseHandler.updated(res, {
            message: 'Alert dismissed',
            data: { alert },
        });
    });

    getMyNotifications = catchAsync(async (req, res) => {
        const query = notificationQuerySchema.parse(req.query);

        const result = await notificationService.getUserNotifications(
            req.user.id,
            query
        );

        ResponseHandler.success(res, {
            message: 'Notifications fetched successfully',
            data: result,
        });
    });

    getUnreadCount = catchAsync(async (req, res) => {
        const result = await notificationService.getUserNotifications(req.user.id, {
            read: false,
            page: 1,
            limit: 1,
        });

        ResponseHandler.success(res, {
            message: 'Unread count fetched',
            data: { unreadCount: result.meta.unreadCount },
        });
    });

    markRead = catchAsync(async (req, res) => {
        const { notificationIds } = markReadSchema.parse(req.body);

        const result = await notificationService.markRead(notificationIds, req.user.id);

        ResponseHandler.updated(res, {
            message: `${result.count} notification(s) marked as read`,
            data: { updated: result.count },
        });
    });


    markAllRead = catchAsync(async (req, res) => {
        const result = await notificationService.markAllRead(req.user.id);

        ResponseHandler.updated(res, {
            message: 'All notifications marked as read',
            data: { updated: result.count },
        });
    });

    deleteNotification = catchAsync(async (req, res) => {
        const { notificationId } = notificationIdParamSchema.parse(req.params);

        const result = await notificationService.deleteNotification(
            notificationId,
            req.user.id,
        );

        ResponseHandler.deleted(res, {
            message: 'Notification deleted successfully',
            data: result,
        });
    });

    deleteNotifications = catchAsync(async (req, res) => {
        const { notificationIds } = deleteNotificationsSchema.parse(req.body);

        const result = await notificationService.deleteNotifications(
            notificationIds,
            req.user.id,
        );

        ResponseHandler.deleted(res, {
            message: `${result.deleted} notification(s) deleted successfully`,
            data: result,
        });
    });


    updateAlertPreference = catchAsync(async (req, res) => {
        const { alertsOptOut } = updateAlertOptOutSchema.parse(req.body);

        const user = await notificationService.updateAlertOptOut(req.user.id, alertsOptOut);

        ResponseHandler.updated(res, {
            message: `Email alerts ${alertsOptOut ? 'disabled' : 'enabled'} successfully`,
            data: { alertsOptOut: user.alertsOptOut },
        });
    });



    createNotification = catchAsync(async (req, res) => {
        const payload = createNotificationSchema.parse(req.body);

        const notification = await notificationService.create(payload);

        ResponseHandler.created(res, {
            message: 'Notification created successfully',
            data: { notification },
        });
    });

    triggerJob = catchAsync(async (req, res) => {
        const { job } = triggerJobSchema.parse(req.body);

        log.info(`Manual job trigger: ${job} by admin ${req.user.id}`);

        let result;
        switch (job) {
            case 'course_expiry':
                result = await notificationService.processEnrollmentExpiryReminders();
                break;
            case 'certificate_expiry':
                result = await notificationService.processCertificateExpiryReminders();
                break;
            case 'certificate_download_expired':
                result = await notificationService.processCertificateDownloadExpiredNotices();
                break;
            case 'enrollment_expiry':
                result = await notificationService.processExpiredEnrollments();
                break;
            case 'inactive_users':
                result = await notificationService.processInactiveUserReminders();
                break;
            case 'company_digest':
                result = await notificationService.processCompanyExpiryDigest();
                break;
            default:
                throw new Error(`Unknown job: ${job}`);
        }

        ResponseHandler.success(res, {
            message: `Job "${job}" executed successfully`,
            data: result,
        });
    });


    runAllJobs = catchAsync(async (req, res) => {
        log.info(`Running all scheduled jobs triggered by admin ${req.user.id}`);

        const results = await notificationService.runAllScheduledJobs();

        ResponseHandler.success(res, {
            message: 'All scheduled notification jobs executed',
            data: results,
        });
    });

    cleanupOldNotifications = catchAsync(async (req, res) => {
        const daysOld = parseInt(req.query.daysOld) || 90;
        const result = await notificationService.deleteOldNotifications(daysOld);

        ResponseHandler.success(res, {
            message: `Deleted ${result.count} old notifications`,
            data: { deleted: result.count },
        });
    });
}

export const notificationController = new NotificationController();