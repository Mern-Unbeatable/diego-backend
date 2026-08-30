import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { supportTicketController } from './supportTicket.controller.js';
import { parseJsonFields } from '../../shared/upload/index.js';
import { uploadTicketFiles } from '../../shared/upload/upload.presets.js';

const parseTicketJsonFields = parseJsonFields(['question']);

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/my', supportTicketController.getMyTickets);
router.post('/', uploadTicketFiles, parseTicketJsonFields, supportTicketController.createTicket);

router.get('/:id', supportTicketController.getTicketById);

const listGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'COMPANY_ADMIN', 'LICENSE_USER');
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/', listGuard, supportTicketController.getAllTickets);
router.patch('/:id', adminGuard, supportTicketController.updateTicket);
router.patch('/:id/status', adminGuard, supportTicketController.updateTicketStatus);
router.delete('/:id', adminGuard, supportTicketController.deleteTicket);

export const supportTicketRoutes = router;