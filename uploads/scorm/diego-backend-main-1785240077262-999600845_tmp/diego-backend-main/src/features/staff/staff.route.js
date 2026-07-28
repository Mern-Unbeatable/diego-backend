import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { staffController } from './staff.controller.js';
import { uploadStaffCreateDocuments, uploadStaffDocumentFile } from '../../shared/upload/upload.presets.js';

const router = express.Router();

router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// Everything here is "Full access mode - master administrator" from your screenshot
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');

router.post('/', adminGuard, uploadStaffCreateDocuments, staffController.createStaffMember);
router.get('/', adminGuard, staffController.getAllStaffMembers);
router.get('/:staffMemberId', adminGuard, staffController.getStaffMemberById);
router.patch('/:staffMemberId', adminGuard, uploadStaffCreateDocuments, staffController.updateStaffMember);
router.delete('/:staffMemberId', adminGuard, staffController.deleteStaffMember);

// "He confirms" / "Cancel" buttons
router.post('/:staffMemberId/confirm', adminGuard, staffController.confirmStaffMember);
router.post('/:staffMemberId/cancel', adminGuard, staffController.cancelStaffMember);

// Document upload / download / delete per document type
router.post(
    '/:staffMemberId/documents/:documentType',
    adminGuard,
    uploadStaffDocumentFile,
    staffController.uploadDocument
);
router.get('/:staffMemberId/documents/:documentType', adminGuard, staffController.downloadDocument);
router.delete('/:staffMemberId/documents/:documentType', adminGuard, staffController.deleteDocument);

export const staffRoutes = router;