import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { lessonController } from './lesson.controller.js';
import { parseLessonJsonFields, uploadLessonFiles } from '../../shared/upload/upload.presets.js';


const router = express.Router({ mergeParams: true });

router.use(authMiddleware.protect);
router.use(i18nMiddleware);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSEE');

router.get('/', lessonController.getLessons);
router.patch('/reorder', adminGuard, lessonController.reorderLessons);
router.get('/progress', lessonController.getUserProgress);
router.get('/:lessonId', lessonController.getLessonById);
router.patch('/:lessonId/progress', lessonController.trackProgress);
router.get('/:lessonId/status', lessonController.getLessonStatus);

router.post('/', adminGuard, uploadLessonFiles, parseLessonJsonFields, lessonController.createLesson);
router.patch('/:lessonId', adminGuard, uploadLessonFiles, parseLessonJsonFields, lessonController.updateLesson);

router.delete('/:lessonId', adminGuard, lessonController.deleteLesson);
router.get('/:lessonId/stats', adminGuard, lessonController.getLessonStats);

export const lessonRoutes = router;