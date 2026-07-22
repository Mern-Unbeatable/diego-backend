import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { quizService } from './quiz.service.js';
import {
    createQuizSchema,
    updateQuizSchema,
    quizQuerySchema,
    submitQuizSchema,
    quizAttemptQuerySchema,
    gradeManualAnswerSchema,
    startQuizQuerySchema,
} from './quiz.validation.js';

class QuizController {
    constructor() {
        this.log = new Logger('QuizController');
    }

    getMyProgress = catchAsync(async (req, res) => {
        const { courseId } = req.params;

        if (!courseId) {
            const progress = await quizService.getMyAllProgress(req.user.id);
            return ResponseHandler.success(res, { message: 'Quiz progress fetched', data: { progress } });
        }

        const progress = await quizService.getMyQuizProgress(courseId, req.user.id);
        ResponseHandler.success(res, { message: 'Quiz progress fetched', data: { progress } });
    });

    getQuizzes = catchAsync(async (req, res) => {
        const { courseId } = req.params;
        const query = quizQuerySchema.parse(req.query);

        const result = await quizService.getQuizzesByCourse(courseId, req.locale, query, req.user);
        ResponseHandler.success(res, { message: 'Quizzes fetched', data: result });
    });


    getQuizForLearner = catchAsync(async (req, res) => {
        const { quizId, courseId } = req.params;
        const { enrollmentId } = startQuizQuerySchema.parse(req.query);

        const quiz = await quizService.getQuizForLearner(
            quizId,
            courseId,
            req.user.id,
            req.locale,
            enrollmentId ?? null,
        );
        if (!quiz) throw new Error('Quiz not found');

        ResponseHandler.success(res, { message: 'Quiz started — questions loaded', data: { quiz } });
    });

    submitQuiz = catchAsync(async (req, res) => {
        const { quizId, courseId } = req.params;
        const { enrollmentId, answers } = submitQuizSchema.parse(req.body);

        const result = await quizService.submitQuizAttempt(
            quizId,
            courseId,
            req.user.id,
            answers,
            enrollmentId ?? null,
        );

        this.log.info(`Quiz submitted: ${quizId} by user ${req.user.id} | score: ${result.scorePercent}% | passed: ${result.passed}`);

        ResponseHandler.created(res, {
            message: result.passed ? 'Quiz passed! Well done.' : 'Quiz submitted. Keep trying!',
            data: { result },
        });
    });

    getMyAttemptDetail = catchAsync(async (req, res) => {
        const { quizId, courseId, attemptId } = req.params;
        const detail = await quizService.getMyAttemptDetail(quizId, courseId, attemptId, req.user.id);
        ResponseHandler.success(res, { message: 'Attempt detail fetched', data: { detail } });
    });

    createQuiz = catchAsync(async (req, res) => {

        console.log('req.body:', req.body)
        console.log('course id check there are :', req.params)
        const { courseId } = req.params;
        if (!courseId) throw new Error('courseId is required in the route');

        const payload = createQuizSchema.parse(req.body);
        const quiz = await quizService.createQuiz(courseId, payload, req.user);

        this.log.info(`Quiz created in course ${courseId} by ${req.user.id}`);
        ResponseHandler.created(res, { message: 'Quiz created successfully', data: { quiz } });
    });

    getQuizById = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const quiz = await quizService.getQuizById(quizId, req.locale, req.user);
        if (!quiz) throw new Error('Quiz not found');
        ResponseHandler.success(res, { message: 'Quiz fetched', data: { quiz } });
    });

    updateQuiz = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const payload = updateQuizSchema.parse(req.body);
        const quiz = await quizService.updateQuiz(quizId, payload, req.user);

        this.log.info(`Quiz updated: ${quizId} by ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'Quiz updated successfully', data: { quiz } });
    });

    deleteQuiz = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        await quizService.deleteQuiz(quizId, req.user);

        this.log.info(`Quiz deleted: ${quizId} by ${req.user.id}`);
        ResponseHandler.success(res, { message: 'Quiz deleted successfully', data: { quizId, deletedAt: new Date().toISOString() } });
    });

    publishQuiz = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const { isPublished } = req.body;

        if (typeof isPublished !== 'boolean') throw new Error('isPublished (boolean) is required');

        const result = await quizService.publishQuiz(quizId, isPublished, req.user);

        this.log.info(`Quiz ${isPublished ? 'published' : 'unpublished'}: ${quizId} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: `Quiz ${isPublished ? 'published' : 'unpublished'} successfully`,
            data: { quiz: result },
        });
    });

    getAttempts = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const query = quizAttemptQuerySchema.parse(req.query);
        const result = await quizService.getQuizAttempts(quizId, query, req.user);
        ResponseHandler.success(res, { message: 'Attempts fetched', data: result });
    });

    getStats = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const stats = await quizService.getQuizStats(quizId, req.user);
        ResponseHandler.success(res, { message: 'Quiz stats fetched', data: { stats } });
    });

    // ✅ NEW
    getPendingReviews = catchAsync(async (req, res) => {
        const { quizId } = req.params;
        const result = await quizService.getPendingManualReviews(quizId, req.user);
        ResponseHandler.success(res, { message: 'Pending reviews fetched', data: { pending: result } });
    });

    // ✅ NEW
    gradeManualAnswer = catchAsync(async (req, res) => {
        const { attemptId } = req.params;
        const { questionId, isCorrect } = gradeManualAnswerSchema.parse(req.body);

        const attempt = await quizService.gradeManualAnswer(attemptId, questionId, isCorrect, req.user);

        this.log.info(`Manual grade applied: attempt ${attemptId}, question ${questionId} by ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'Answer graded successfully', data: { attempt } });
    });
}

export const quizController = new QuizController();
export { QuizController };