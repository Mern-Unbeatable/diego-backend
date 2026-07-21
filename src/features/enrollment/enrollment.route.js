
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { enrollmentController } from './enrollment.controller.js';
import { tenantGuard } from '../../shared/globals/helpers/tenant.middleware.js';

const router = express.Router({ mergeParams: true });

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// Public/User routes
router.get('/my', enrollmentController.getMyEnrollments);
router.get('/my-progress/:courseId', enrollmentController.getMyProgress);
router.patch(
    '/:enrollmentId/lessons/:lessonId/progress',
    enrollmentController.updateLessonProgress
);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSEE');

// Licensee's all course enrollments
router.get('/licensee/students', adminGuard, tenantGuard, enrollmentController.getLicenseeStudents);
router.get('/licensee/all', adminGuard, tenantGuard, enrollmentController.getLicenseeAllEnrollments);


router.get('/licensee/students/:studentId', adminGuard, tenantGuard, enrollmentController.getLicenseeStudentDetail);

// Admin routes
router.get('/stats/:courseId', adminGuard, tenantGuard, enrollmentController.getEnrollmentStats);
router.post('/bulk', adminGuard, tenantGuard, enrollmentController.bulkEnroll);
router.post('/', adminGuard, tenantGuard, enrollmentController.createEnrollment);
router.get('/', adminGuard, tenantGuard, enrollmentController.getAllEnrollments);
router.get('/:id', adminGuard, tenantGuard, enrollmentController.getEnrollmentById);
router.patch('/:id', adminGuard, tenantGuard, enrollmentController.updateEnrollment);
router.delete('/:id', adminGuard, tenantGuard, enrollmentController.deleteEnrollment);

export const enrollmentRoutes = router;