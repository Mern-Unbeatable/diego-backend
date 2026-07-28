import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';

import { userController } from './user.controller.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';

const router = express.Router();
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/me', userController.getMe);
router.patch('/me', userController.updateProfile);
router.delete('/me', userController.deleteMe);
router.get('/me/stats', userController.getMyStats);
router.get('/me/enrollments', userController.getMyEnrollments);

router.get('/admin', authMiddleware.authorize('PLATFORM_ADMIN'), userController.getAllUsers);

router.get('/admin/user/:id', authMiddleware.authorize('PLATFORM_ADMIN'), userController.getUserById);
router.patch('/admin/:id/verify', authMiddleware.authorize('PLATFORM_ADMIN'), userController.setUserVerified);

router.patch('/admin/:id/status', authMiddleware.authorize('PLATFORM_ADMIN'), userController.setUserStatus);
router.delete('/admin/:id', authMiddleware.authorize('PLATFORM_ADMIN'), userController.deleteUser);

export const userRoutes = router;