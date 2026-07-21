import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { lessonController } from './lesson.controller.js';
import { parseLessonJsonFields, uploadLessonFiles } from '../../shared/upload/upload.presets.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// PLATFORM_ADMIN + LICENSE_USER — lesson CRUD on own courses
const courseManagerGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');

router.get('/my-progress', lessonController.getMyAllProgress);
router.get('/:lessonId/stats', courseManagerGuard, lessonController.getLessonStats);
router.get('/:lessonId/status', lessonController.getLessonStatus);
router.patch('/:lessonId/progress', lessonController.trackProgress);
router.get('/:lessonId', lessonController.getLessonById);

router.patch('/:lessonId', courseManagerGuard, uploadLessonFiles, parseLessonJsonFields, lessonController.updateLesson);
router.delete('/:lessonId', courseManagerGuard, lessonController.deleteLesson);

export const lessonStandaloneRoutes = router;