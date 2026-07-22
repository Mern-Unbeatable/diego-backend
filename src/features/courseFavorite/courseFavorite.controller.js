import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { courseFavoriteService } from './courseFavorite.service.js';
import {
    courseIdParamSchema,
    favoriteCourseQuerySchema,
} from './courseFavorite.validation.js';

class CourseFavoriteController {
    constructor() {
        this.log = new Logger('CourseFavoriteController');
    }

    getMyFavoriteCourses = catchAsync(async (req, res) => {
        const query = favoriteCourseQuerySchema.parse(req.query);
        const result = await courseFavoriteService.getMyFavoriteCourses(
            req.user.id,
            query,
            req.locale,
            req.tenantId,
        );

        ResponseHandler.success(res, {
            message: 'Favorite courses fetched successfully',
            data: result,
        });
    });

    getMyFavoriteCourseIds = catchAsync(async (req, res) => {
        const courseIds = await courseFavoriteService.getMyFavoriteCourseIds(req.user.id);

        ResponseHandler.success(res, {
            message: 'Favorite course IDs fetched successfully',
            data: { courseIds, total: courseIds.length },
        });
    });

    checkFavorite = catchAsync(async (req, res) => {
        const { courseId } = courseIdParamSchema.parse(req.params);
        const result = await courseFavoriteService.isFavorite(courseId, req.user.id);

        ResponseHandler.success(res, {
            message: 'Favorite status fetched successfully',
            data: result,
        });
    });

    addFavorite = catchAsync(async (req, res) => {
        const { courseId } = courseIdParamSchema.parse(req.params);
        const favorite = await courseFavoriteService.addFavorite(
            courseId,
            req.user.id,
            req.tenantId,
        );

        this.log.info(`Course favorited: ${courseId} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Course added to favorites successfully',
            data: { favorite },
        });
    });

    removeFavorite = catchAsync(async (req, res) => {
        const { courseId } = courseIdParamSchema.parse(req.params);
        const result = await courseFavoriteService.removeFavorite(courseId, req.user.id);

        this.log.info(`Course unfavorited: ${courseId} by ${req.user.id}`);
        ResponseHandler.deleted(res, {
            message: 'Course removed from favorites successfully',
            data: result,
        });
    });
}

export const courseFavoriteController = new CourseFavoriteController();
