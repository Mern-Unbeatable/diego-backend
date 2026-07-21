import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { lessonController } from './lesson.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/my-progress', lessonController.getMyAllProgress);
router.get('/:lessonId', lessonController.getLessonById);
router.patch('/:lessonId/progress', lessonController.trackProgress);
router.get('/:lessonId/status', lessonController.getLessonStatus);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');
router.patch('/:lessonId', adminGuard, lessonController.updateLesson);


router.delete('/:lessonId', adminGuard, lessonController.deleteLesson);
router.get('/:lessonId/stats', adminGuard, lessonController.getLessonStats);

export const lessonStandaloneRoutes = router;