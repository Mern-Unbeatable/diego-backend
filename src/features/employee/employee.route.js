import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { employeeController } from './employee.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const companyAdminGuard = authMiddleware.authorize('COMPANY_ADMIN');

router.post('/', companyAdminGuard, employeeController.addEmployee);
router.get('/', companyAdminGuard, employeeController.getCompanyEmployees);
router.get('/:userId', companyAdminGuard, employeeController.getEmployeeDetail);
router.patch('/:userId', companyAdminGuard, employeeController.updateEmployee);
router.delete('/:userId/permanent', companyAdminGuard, employeeController.removeEmployeePermanent);
router.delete('/:userId', companyAdminGuard, employeeController.removeEmployee);

export const employeeRoutes = router;