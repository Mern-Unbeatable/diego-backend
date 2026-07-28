import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { supportTicketController } from './supportTicket.controller.js';
import { parseLessonJsonFields, uploadLessonFiles, uploadTicketFiles } from '../../shared/upload/upload.presets.js';

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/my', supportTicketController.getMyTickets);
router.post('/', uploadTicketFiles, parseLessonJsonFields, supportTicketController.createTicket);

router.get('/:id', supportTicketController.getTicketById);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/', adminGuard, supportTicketController.getAllTickets);
router.patch('/:id', adminGuard, supportTicketController.updateTicket);
router.patch('/:id/status', adminGuard, supportTicketController.updateTicketStatus);
router.delete('/:id', adminGuard, supportTicketController.deleteTicket);

export const supportTicketRoutes = router;