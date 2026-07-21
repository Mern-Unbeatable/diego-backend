import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { courseReviewController } from './courseReview.controller.js';

const router = express.Router();

// Public routes - get course reviews
router.get('/course/:courseId', courseReviewController.getCourseReviews);

// ── Protected routes ──
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// User routes
router.post('/', courseReviewController.createCourseReview);
router.get('/my', courseReviewController.getMyCourseReviews);
router.get('/:id', courseReviewController.getCourseReviewById);
router.patch('/:id', courseReviewController.updateMyCourseReview);
router.delete('/:id', courseReviewController.deleteMyCourseReview);

// Admin routes
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER', 'COMPANY_ADMIN');
router.get('/', adminGuard, courseReviewController.getAllCourseReviews);
router.delete('/:id/admin', adminGuard, courseReviewController.adminDeleteCourseReview);

export const courseReviewRoutes = router;