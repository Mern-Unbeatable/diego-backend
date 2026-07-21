
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { contactController } from './contact.controller.js';

const router = express.Router();

// Public routes
router.use(tenantMiddleware);
router.use(i18nMiddleware);

// Public contact 
router.post('/', contactController.createContact);

// Admin routes
router.use(authMiddleware.protect);
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.patch('/:id/status', adminGuard, contactController.updateStatus);

router.get('/', adminGuard, contactController.getAllContacts);
router.get('/:id', adminGuard, contactController.getContactById);
router.patch('/:id', adminGuard, contactController.updateContact);
router.delete('/:id', adminGuard, contactController.deleteContact);



export const contactRoutes = router;