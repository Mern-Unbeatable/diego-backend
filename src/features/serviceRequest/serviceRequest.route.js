import { Router } from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { serviceRequestController } from './serviceRequest.controller.js';
import { uploadServiceRequestFiles } from '../../shared/upload/upload.presets.js';

const router = Router();

//Apply global middlewares ──
router.use(tenantMiddleware);
router.use(i18nMiddleware);

// ── Public routes 
router.post('/', uploadServiceRequestFiles, serviceRequestController.submitServiceRequest);

// ── Admin only routes ──
router.use(authMiddleware.protect);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/', adminGuard, serviceRequestController.getAllServiceRequests);
router.get('/:serviceRequestId', adminGuard, serviceRequestController.getServiceRequestById);
router.patch('/:serviceRequestId/status', adminGuard, serviceRequestController.updateServiceRequestStatus);
router.delete('/:serviceRequestId', adminGuard, serviceRequestController.deleteServiceRequest);

export const serviceRequestRoutes = router;