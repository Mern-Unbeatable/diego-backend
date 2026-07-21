
import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { packageController } from './package.controller.js';

const router = express.Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/', packageController.getAllPackages);
router.get('/slug/:slug', packageController.getPackageBySlug);
router.get('/:id', packageController.getPackageById);


const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN');

router.post('/', adminGuard, packageController.createPackage);
router.patch('/:id', adminGuard, packageController.updatePackage);
router.delete('/:id', adminGuard, packageController.deletePackage);
router.patch('/:id/toggle-active', adminGuard, packageController.toggleActive);
router.get('/:id/stats', adminGuard, packageController.getPackageStats);

export const packageRoutes = router;