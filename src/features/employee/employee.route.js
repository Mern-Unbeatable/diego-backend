import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { employeeController } from './employee.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const companyAdminGuard = authMiddleware.authorize('COMPANY_ADMIN');

router.post('/', companyAdminGuard, employeeController.addEmployee);
router.get('/overview', companyAdminGuard, employeeController.getCompanyOverview);
router.get('/progress-report', companyAdminGuard, employeeController.getProgressReport);
router.get('/enrollments', companyAdminGuard, employeeController.getCompanyEnrollments);
router.get('/certificates', companyAdminGuard, employeeController.getCompanyCertificates);
router.get('/assignable-courses', companyAdminGuard, employeeController.getAssignableCourses);
router.get('/role-suggestions', companyAdminGuard, employeeController.getRoleSuggestions);
router.get('/', companyAdminGuard, employeeController.getCompanyEmployees);
router.get('/:userId/enrollments', companyAdminGuard, employeeController.getEmployeeEnrollments);
router.get('/:userId/enrollments/:enrollmentId', companyAdminGuard, employeeController.getEmployeeEnrollmentDetail);
router.post('/:userId/assign-courses', companyAdminGuard, employeeController.assignCoursesToEmployee);
router.get('/:userId/certificates', companyAdminGuard, employeeController.getEmployeeCertificates);
router.get('/:userId/certificates/:certificateId/download', companyAdminGuard, employeeController.downloadEmployeeCertificate);
router.get('/:userId', companyAdminGuard, employeeController.getEmployeeDetail);
router.patch('/:userId', companyAdminGuard, employeeController.updateEmployee);
router.delete('/:userId/permanent', companyAdminGuard, employeeController.removeEmployeePermanent);
router.delete('/:userId', companyAdminGuard, employeeController.removeEmployee);

export const employeeRoutes = router;