import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { companyCoursePurchaseController } from './companyCoursePurchase.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
const companyGuard = authMiddleware.authorize('COMPANY_ADMIN', 'PLATFORM_ADMIN');

router.get('/my-purchases', companyGuard, companyCoursePurchaseController.getMyPurchases);
router.get('/:id', companyGuard, companyCoursePurchaseController.getPurchaseById);
router.post('/assign-seat', companyGuard, companyCoursePurchaseController.assignSeat);
router.post('/bulk-assign', companyGuard, companyCoursePurchaseController.bulkAssignSeats);
router.post('/invite-employee', companyGuard, companyCoursePurchaseController.inviteAndAssignEmployee);
router.post('/send-access-link', companyGuard, companyCoursePurchaseController.sendAccessLink);
router.delete('/revoke/:enrollmentId', companyGuard, companyCoursePurchaseController.revokeSeat);

export const companyCoursePurchaseRoutes = router;