import { Router } from 'express';
import { coursePackageController } from './coursePackage.controller.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';

const router = Router();
router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER');

router.get('/for-selection', coursePackageController.getForSelection);
router.get('/', coursePackageController.getAll);
router.get('/:id', coursePackageController.getById);
router.post('/', adminGuard, coursePackageController.create);
router.patch('/:id', adminGuard, coursePackageController.update);
router.delete('/:id', adminGuard, coursePackageController.delete);

export default router;
export const coursePackageRoutes = router;