import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { enrollmentController } from './enrollment.controller.js';
import { tenantGuard } from '../../shared/globals/helpers/tenant.middleware.js';

const router = express.Router({ mergeParams: true });

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');

// ── Specific paths first (before /:id) ──
router.get('/my', enrollmentController.getMyEnrollments);
router.get('/my-progress/:courseId', enrollmentController.getMyProgress);
router.post('/my-progress/:courseId/ensure-certificate', enrollmentController.ensureMyCertificate);
router.post('/:enrollmentId/anti-cheat', enrollmentController.logAntiCheat);

// ── License user dashboard & student management ──
router.get('/licensee/overview', adminGuard, tenantGuard, enrollmentController.getLicenseeOverview);
router.get('/licensee/students', adminGuard, tenantGuard, enrollmentController.getLicenseeStudents);
router.get('/licensee/students/:studentId', adminGuard, tenantGuard, enrollmentController.getLicenseeStudentDetail);
router.get('/licensee/all', adminGuard, tenantGuard, enrollmentController.getLicenseeAllEnrollments);

// ── Admin / license user enrollment management ──
router.get('/stats/:courseId', adminGuard, tenantGuard, enrollmentController.getEnrollmentStats);
router.post('/bulk', adminGuard, tenantGuard, enrollmentController.bulkEnroll);
router.post('/', adminGuard, tenantGuard, enrollmentController.createEnrollment);
router.get('/', adminGuard, tenantGuard, enrollmentController.getAllEnrollments);

// ── Parameterized routes last ──
router.patch(
    '/:enrollmentId/lessons/:lessonId/progress',
    enrollmentController.updateLessonProgress
);
router.get('/:id', enrollmentController.getEnrollmentById);
router.patch('/:id', adminGuard, tenantGuard, enrollmentController.updateEnrollment);
router.delete('/:id', adminGuard, tenantGuard, enrollmentController.deleteEnrollment);

export const enrollmentRoutes = router;
