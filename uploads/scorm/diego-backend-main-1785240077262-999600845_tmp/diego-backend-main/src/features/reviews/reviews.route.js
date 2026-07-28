import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { i18nMiddleware } from '../../shared/globals/helpers/I18n.middleware.js';
import { reviewController } from './reviews.controller.js';

const router = express.Router();

// PUBLIC ROUTES

router.get('/', reviewController.getReviews);

// Anyone can submit a review 
router.post('/', reviewController.createReview);

//  ADMIN ROUTES (Authentication required) 

router.use(authMiddleware.protect);
router.use(i18nMiddleware);


const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSE_USER', 'COMPANY_ADMIN');


router.get('/all', adminGuard, reviewController.getAllReviews);

// Publish/unpublish a review
router.patch('/:id/publish', adminGuard, reviewController.publishReview);

// Delete a review
router.delete('/:id', adminGuard, reviewController.deleteReview);

export const reviewRoutes = router;