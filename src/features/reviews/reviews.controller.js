import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { reviewService } from './reviews.service.js';
import {
    createReviewSchema,
    updateReviewSchema,
    publishReviewSchema,
} from './reviews.validation.js';

class ReviewController {
    constructor() {
        this.log = new Logger('ReviewController');
    }


    createReview = catchAsync(async (req, res) => {
        const payload = createReviewSchema.parse(req.body);
        const review = await reviewService.createReview(payload, req.tenantId);

        this.log.info(`Review created: ${review.id}`);
        ResponseHandler.created(res, {
            message: 'Review submitted successfully. It will be visible after admin approval.',
            data: { review },
        });
    });


    getReviews = catchAsync(async (req, res) => {
        const result = await reviewService.getReviews(req.query, req.tenantId);

        ResponseHandler.success(res, {
            message: 'Reviews fetched successfully',
            data: result,
        });
    });



    getAllReviews = catchAsync(async (req, res) => {
        const result = await reviewService.getAllReviews(req.query, req.tenantId);

        ResponseHandler.success(res, {
            message: 'All reviews fetched successfully',
            data: result,
        });
    });


    publishReview = catchAsync(async (req, res) => {
        const payload = publishReviewSchema.parse(req.body);
        const review = await reviewService.publishReview(req.params.id, payload, req.tenantId);

        this.log.info(`Review ${payload.isPublished ? 'published' : 'unpublished'}: ${req.params.id}`);
        ResponseHandler.updated(res, {
            message: `Review ${payload.isPublished ? 'published' : 'unpublished'} successfully`,
            data: { review },
        });
    });


    deleteReview = catchAsync(async (req, res) => {
        await reviewService.deleteReview(req.params.id, req.tenantId);

        this.log.info(`Review deleted: ${req.params.id}`);
        ResponseHandler.success(res, {
            message: 'Review deleted successfully',
            data: { reviewId: req.params.id },
        });
    });
}

export const reviewController = new ReviewController();