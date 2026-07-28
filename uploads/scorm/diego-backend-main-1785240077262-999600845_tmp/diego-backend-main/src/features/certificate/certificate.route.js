import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { certificateController } from './certificate.controller.js';
import { uploadCertificateFiles } from '../../shared/upload/upload.presets.js';

const router = express.Router();

router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

// ── Public/User routes ──
router.get('/my', certificateController.getMyCertificates);
router.get('/verify/:certificateId', certificateController.verifyCertificate);
router.get('/:id/download', certificateController.downloadCertificate);
router.get('/:id', certificateController.getCertificateById);

// ── Generate: PLATFORM_ADMIN + LICENSE_USER + COMPANY_ADMIN 
const generateGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER', 'COMPANY_ADMIN');
router.post('/generate', generateGuard, uploadCertificateFiles, certificateController.generateCertificate);

// ── Admin only ──
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');
router.get('/', adminGuard, certificateController.getAllCertificates);
router.patch('/:id', adminGuard, uploadCertificateFiles, certificateController.updateCertificate);
router.delete('/:id', adminGuard, certificateController.deleteCertificate);

export const certificateRoutes = router;