
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { courseController } from './course.controller.js';
import { lessonRoutes } from '../lesson/lesson.route.js';
import { uploadCourseFiles, parseCourseJsonFields } from '../../shared/upload/upload.presets.js';

const router = express.Router();

// ============================================
//  PUBLIC ROUTES - NO AUTH
// ============================================

router.get('/public', courseController.getPublicCourses);
router.get('/:id', courseController.getCourseById);
router.get('/slug/:slug', courseController.getCourseBySlug);

// ============================================
//  PROTECTED ROUTES - AUTH REQUIRED
// ============================================

router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// ============================================
//  ROUTE ORDER - SPECIFIC BEFORE PARAMETERIZED
// ============================================

// 1. Specific routes first
router.get('/my', courseController.getMyCourses);

// 2. Then routes with parameters
router.get('/', courseController.getAllCourses);

// ============================================
//  ADMIN ROUTES
// ============================================
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');

router.post('/', adminGuard, uploadCourseFiles, parseCourseJsonFields, courseController.createCourse);
router.patch('/:id', adminGuard, uploadCourseFiles, parseCourseJsonFields, courseController.updateCourse);
router.delete('/:id', adminGuard, courseController.deleteCourse);
router.patch('/:id/toggle-active', adminGuard, courseController.toggleActive);
router.get('/:id/stats', adminGuard, courseController.getCourseStats);

// ============================================
//  COMPANY ROUTES
// ============================================
const companyGuard = authMiddleware.authorize('COMPANY_ADMIN', 'PLATFORM_ADMIN');
router.post('/company/assign-employee', companyGuard, courseController.assignEmployee);
router.delete('/company/enrollment/:enrollmentId', companyGuard, courseController.removeEmployee);

// ============================================
//  LESSON ROUTES
// ============================================
router.use('/:courseId/lessons', lessonRoutes);

export const courseRoutes = router;