import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { tenantMiddleware } from '../../shared/globals/helpers/tenant.middleware.js';
import { courseFavoriteController } from './courseFavorite.controller.js';

const router = express.Router();

router.use(tenantMiddleware);
router.use(authMiddleware.protect);
router.use(i18nMiddleware);

router.get('/', courseFavoriteController.getMyFavoriteCourses);
router.get('/:id', courseFavoriteController.getMyFavoriteCourseIds);
router.get('/check/:courseId', courseFavoriteController.checkFavorite);
router.post('/:courseId', courseFavoriteController.addFavorite);
router.delete('/:courseId', courseFavoriteController.removeFavorite);

export const courseFavoriteRoutes = router;
