
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { collaborationController } from './collaboration.controller.js';

const router = express.Router();

// Public routes
router.use(tenantMiddleware);
router.use(i18nMiddleware);

// Public collaboration form submission
router.post('/', collaborationController.createCollaboration);

// Admin routes
router.use(authMiddleware.protect);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');

router.get('/', adminGuard, collaborationController.getAllCollaborations);
router.get('/:id', adminGuard, collaborationController.getCollaborationById);
router.patch('/:id/status', adminGuard, collaborationController.updateCollaborationStatus);
router.delete('/:id', adminGuard, collaborationController.deleteCollaboration);

export const collaborationRoutes = router;