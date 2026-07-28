import { Logger } from '../../config/logger.js';
import { NotFoundError } from '../../shared/globals/helpers/error-handler.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { lessonService } from './lesson.service.js';
import {
    createLessonSchema,
    updateLessonSchema,
    reorderLessonsSchema,
    trackProgressSchema,
} from './lesson.validation.js';

class LessonController {
    constructor() {
        this.log = new Logger('LessonController');
    }

    getMyAllProgress = catchAsync(async (req, res) => {
        const progress = await lessonService.getMyAllProgress(
            req.user.id,
            req.locale,
            req.query
        );

        ResponseHandler.success(res, {
            message: 'User progress fetched successfully',
            data: { progress },
        });
    });



    getLessonById = catchAsync(async (req, res) => {
        const includeProgress = req.query.includeProgress === 'true';
        const userId = req.user?.id || null;

        const lesson = await lessonService.getLessonByIdStandalone(
            req.params.lessonId,
            req.locale,
            includeProgress,
            userId,
            req.user
        );

        if (!lesson) throw new NotFoundError('Lesson not found');

        ResponseHandler.success(res, {
            message: 'Lesson fetched successfully',
            data: { lesson }
        });
    });

    getLessonStatus = catchAsync(async (req, res) => {
        const status = await lessonService.getLessonStatus(
            req.params.lessonId,
            req.user.id,
            req.locale
        );

        ResponseHandler.success(res, {
            message: 'Lesson status fetched successfully',
            data: { status }
        });
    });

    trackProgress = catchAsync(async (req, res) => {
        const payload = trackProgressSchema.parse(req.body);

        const progress = await lessonService.trackProgress(
            req.params.lessonId,
            req.user.id,
            payload,
            req.user
        );

        this.log.info(`Progress tracked for lesson ${req.params.lessonId} by user ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Progress tracked successfully',
            data: { progress },
        });
    });

    updateLesson = catchAsync(async (req, res) => {
        const payload = updateLessonSchema.parse(req.body);
        const lesson = await lessonService.updateLesson(
            req.params.lessonId,
            payload,
            req.user
        );

        this.log.info(`Lesson updated: ${req.params.lessonId} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Lesson updated successfully',
            data: { lesson }
        });
    });
    deleteLesson = catchAsync(async (req, res) => {
        await lessonService.deleteLesson(
            req.params.lessonId,
            req.user
        );

        this.log.info(`Lesson deleted: ${req.params.lessonId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Lesson deleted successfully',
            data: {
                lessonId: req.params.lessonId,
                deletedAt: new Date().toISOString()
            },
        });
    });
    getLessonStats = catchAsync(async (req, res) => {
        const stats = await lessonService.getLessonStats(
            req.params.lessonId,
            req.user,
            req.locale
        );
        ResponseHandler.success(res, {
            message: 'Lesson statistics fetched',
            data: { stats }
        });
    });
    getLessons = catchAsync(async (req, res) => {
        const result = await lessonService.getLessonsByCourse(
            req.params.courseId,
            req.locale,
            req.query,
            req.user
        );
        ResponseHandler.success(res, {
            message: 'Lessons fetched successfully',
            data: result
        });
    });
    createLesson = catchAsync(async (req, res) => {
        const payload = createLessonSchema.parse(req.body);
        const lesson = await lessonService.createLesson(
            req.params.courseId,
            payload,
            req.user
        );

        this.log.info(`Lesson created in course ${req.params.courseId} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Lesson created successfully',
            data: { lesson }
        });
    });

    reorderLessons = catchAsync(async (req, res) => {

        try {
            const { lessons } = reorderLessonsSchema.parse(req.body);
            const result = await lessonService.reorderLessons(
                req.params.courseId,
                lessons,
                req.user
            );

            ResponseHandler.updated(res, {
                message: 'Lessons reordered successfully',
                data: { lessons: result },
            });
        } catch (error) {
            console.error(' Reorder error:', error);
            throw error;
        }
    });

    getUserProgress = catchAsync(async (req, res) => {
        const progress = await lessonService.getUserProgress(
            req.params.courseId,
            req.user.id,
            req.user,
            req.locale
        );

        ResponseHandler.success(res, {
            message: 'User progress fetched successfully',
            data: { progress },
        });
    });
}

export const lessonController = new LessonController();
export { LessonController };