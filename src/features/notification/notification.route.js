import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { notificationController } from './notification.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);

router.get('/deadlines', notificationController.getMyDeadlines);
router.get('/alerts', notificationController.getMyAlerts);
router.patch('/alerts/:alertId/dismiss', notificationController.dismissAlert);

router.get('/', notificationController.getMyNotifications);

router.get('/unread-count', notificationController.getUnreadCount);

router.patch('/mark-read', notificationController.markRead);
router.patch('/mark-all-read', notificationController.markAllRead);
router.patch('/alert-preference', notificationController.updateAlertPreference);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.post('/admin/create', adminGuard, notificationController.createNotification);
router.post('/admin/trigger-job', adminGuard, notificationController.triggerJob);
router.post('/admin/run-all-jobs', adminGuard, notificationController.runAllJobs);
router.delete('/admin/cleanup', adminGuard, notificationController.cleanupOldNotifications);

export const notificationRoutes = router;