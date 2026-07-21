import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { courseReviewService } from './courseReview.service.js';
import {
    createCourseReviewSchema,
    updateCourseReviewSchema,
} from './courseReview.validation.js';

class CourseReviewController {
    constructor() {
        this.log = new Logger('CourseReviewController');
    }

    createCourseReview = catchAsync(async (req, res) => {
        const payload = createCourseReviewSchema.parse(req.body);
        const review = await courseReviewService.createCourseReview(payload, req.user);

        this.log.info(`Course review created: ${review.id} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Review submitted successfully.',
            data: { review },
        });
    });

    getMyCourseReviews = catchAsync(async (req, res) => {
        const result = await courseReviewService.getMyCourseReviews(req.user.id, req.query);

        ResponseHandler.success(res, {
            message: 'My course reviews fetched',
            data: result,
        });
    });

    getCourseReviews = catchAsync(async (req, res) => {
        const { courseId } = req.params;
        const result = await courseReviewService.getCourseReviews(courseId, req.query);

        ResponseHandler.success(res, {
            message: 'Course reviews fetched',
            data: result,
        });
    });

    getCourseReviewById = catchAsync(async (req, res) => {
        const review = await courseReviewService.getCourseReviewById(req.params.id, req.user);

        ResponseHandler.success(res, {
            message: 'Course review fetched',
            data: { review },
        });
    });

    updateMyCourseReview = catchAsync(async (req, res) => {
        const payload = updateCourseReviewSchema.parse(req.body);
        const review = await courseReviewService.updateMyCourseReview(req.params.id, payload, req.user.id);

        this.log.info(`Course review updated: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Course review updated successfully',
            data: { review },
        });
    });

    deleteMyCourseReview = catchAsync(async (req, res) => {
        await courseReviewService.deleteMyCourseReview(req.params.id, req.user.id);

        this.log.info(`Course review deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Course review deleted successfully',
            data: { reviewId: req.params.id },
        });
    });

    getAllCourseReviews = catchAsync(async (req, res) => {
        const result = await courseReviewService.getAllCourseReviews(req.query, req.user);

        ResponseHandler.success(res, {
            message: 'All course reviews fetched',
            data: result,
        });
    });

    adminDeleteCourseReview = catchAsync(async (req, res) => {
        await courseReviewService.deleteCourseReview(req.params.id, req.user);

        this.log.info(`Course review admin-deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Course review deleted successfully',
            data: { reviewId: req.params.id },
        });
    });
}

export const courseReviewController = new CourseReviewController();