import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { quizController } from './quiz.controller.js';

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');

// ===== STUDENT ROUTES =====
router.get('/my-progress', quizController.getMyProgress);
router.get('/:courseId/my-progress', quizController.getMyProgress);
router.get('/:courseId/available', quizController.getQuizzes);
router.get('/:courseId/start-quiz/:quizId', quizController.getQuizForLearner);
router.post('/:courseId/submit/:quizId', quizController.submitQuiz);
router.get('/:courseId/:quizId/attempts/:attemptId/review', quizController.getMyAttemptDetail);

// ===== ADMIN ROUTES =====
router.get('/attempts/:attemptId/grade', adminGuard, (req, res) => res.status(405).json({ message: 'Use PATCH' })); // safety guard, optional
router.patch('/attempts/:attemptId/grade', adminGuard, quizController.gradeManualAnswer);
router.post('/:courseId', adminGuard, quizController.createQuiz);
router.get('/:quizId/pending-reviews', adminGuard, quizController.getPendingReviews);
router.get('/:quizId', adminGuard, quizController.getQuizById);
router.patch('/:quizId', adminGuard, quizController.updateQuiz);
router.delete('/:quizId', adminGuard, quizController.deleteQuiz);
router.patch('/:quizId/publish', adminGuard, quizController.publishQuiz);
router.get('/:quizId/attempts', adminGuard, quizController.getAttempts);
router.get('/:quizId/stats', adminGuard, quizController.getStats);

export const quizRoutes = router;