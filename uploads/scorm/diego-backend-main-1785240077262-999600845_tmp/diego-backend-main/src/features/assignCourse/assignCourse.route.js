
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { assignCourseController } from './assignCourse.controller.js';

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/my', assignCourseController.getMyAssignments);
router.get('/', assignCourseController.getAllAssignments);
router.get('/user/:userId', assignCourseController.getUserAssignments);
router.post('/', assignCourseController.assignCourse);
router.post('/bulk', assignCourseController.bulkAssignCourse);

router.patch('/:id', assignCourseController.updateAssignment);

router.delete('/:id', assignCourseController.deleteAssignment);

export const assignCourseRoutes = router;