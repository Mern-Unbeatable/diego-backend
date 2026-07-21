import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { enrollmentService } from './enrollment.service.js';
import {
    createEnrollmentSchema,
    createSelfEnrollmentSchema,
    updateEnrollmentSchema,
    enrollmentQuerySchema,
    generateAccessLinkSchema,
    accessLinkSchema,
    bulkEnrollSchema,
} from './enrollment.validation.js';

class EnrollmentController {
    constructor() {
        this.log = new Logger('EnrollmentController');
    }
    createEnrollment = catchAsync(async (req, res) => {
        const payload = createEnrollmentSchema.parse(req.body);
        const enrollment = await enrollmentService.createEnrollment(payload, req.user);

        this.log.info(`Enrollment created: ${enrollment.id} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Enrollment created successfully',
            data: { enrollment },
        });
    });



    bulkEnroll = catchAsync(async (req, res) => {
        const payload = bulkEnrollSchema.parse(req.body);
        const result = await enrollmentService.bulkEnroll(payload, req.user);

        this.log.info(`Bulk enrollment: ${result.newlyEnrolled} users enrolled by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Bulk enrollment completed',
            data: result,
        });
    });






    getMyEnrollments = catchAsync(async (req, res) => {
        const query = enrollmentQuerySchema.parse(req.query);
        const result = await enrollmentService.getEnrollments(query, req.user.id, req.user, req.locale);

        ResponseHandler.success(res, {
            message: 'My enrollments fetched',
            data: result,
        });
    });

    getAllEnrollments = catchAsync(async (req, res) => {
        const query = enrollmentQuerySchema.parse(req.query);
        const result = await enrollmentService.getEnrollments(query, null, req.user, req.locale);

        ResponseHandler.success(res, {
            message: 'Enrollments fetched',
            data: result,
        });
    });


    getEnrollmentById = catchAsync(async (req, res) => {
        const { id } = req.params;
        const enrollment = await enrollmentService.getEnrollmentById(id, null, req.user);

        if (!enrollment) throw new Error('Enrollment not found');
        ResponseHandler.success(res, {
            message: 'Enrollment fetched',
            data: { enrollment },
        });
    });

    updateEnrollment = catchAsync(async (req, res) => {
        const { id } = req.params;
        const payload = updateEnrollmentSchema.parse(req.body);

        const enrollment = await enrollmentService.updateEnrollment(id, payload, null, req.user);

        this.log.info(`Enrollment updated: ${id} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Enrollment updated successfully',
            data: { enrollment },
        });
    });


    deleteEnrollment = catchAsync(async (req, res) => {
        const { id } = req.params;
        await enrollmentService.deleteEnrollment(id, req.user);

        this.log.info(`Enrollment deleted: ${id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Enrollment deleted successfully',
            data: { enrollmentId: id, deletedAt: new Date().toISOString() },
        });
    });


    updateLessonProgress = catchAsync(async (req, res) => {
        const { enrollmentId, lessonId } = req.params;
        const { completed, timeSpentSecs } = req.body;
        const progress = await enrollmentService.updateLessonProgress(
            enrollmentId,
            lessonId,
            { completed, timeSpentSecs },
            req.user
        );

        this.log.info(`Lesson progress updated: ${lessonId} for enrollment ${enrollmentId}`);
        ResponseHandler.updated(res, {
            message: 'Lesson progress updated',
            data: { progress },
        });
    });

    getEnrollmentStats = catchAsync(async (req, res) => {
        const { courseId } = req.params;

        const stats = await enrollmentService.getEnrollmentStats(courseId, req.user);

        ResponseHandler.success(res, {
            message: 'Enrollment stats fetched',
            data: { stats },
        });
    });

    getMyProgress = catchAsync(async (req, res) => {
        const { courseId } = req.params;

        const progress = await enrollmentService.getMyProgress(courseId, req.user.id);

        ResponseHandler.success(res, {
            message: 'Progress fetched',
            data: { progress },
        });
    });
    getLicenseeOverview = catchAsync(async (req, res) => {
        const query = enrollmentQuerySchema.parse(req.query);
        const result = await enrollmentService.getLicenseeOverview(query, req.user, req.locale);

        ResponseHandler.success(res, {
            message: 'License dashboard fetched successfully',
            data: result,
        });
    });

    getLicenseeAllEnrollments = catchAsync(async (req, res) => {
        const query = enrollmentQuerySchema.parse(req.query);

        const result = await enrollmentService.getLicenseeAllEnrollments(
            query,
            req.user,
            req.locale
        );

        ResponseHandler.success(res, {
            message: 'Licensee enrollments fetched successfully',
            data: result
        });
    });

    getLicenseeStudents = catchAsync(async (req, res) => {
        const query = enrollmentQuerySchema.parse(req.query);
        const result = await enrollmentService.getLicenseeStudents(query, req.user, req.locale);

        ResponseHandler.success(res, {
            message: 'Licensee students fetched successfully',
            data: result,
        });
    });

    getLicenseeStudentDetail = catchAsync(async (req, res) => {
        const { studentId } = req.params;
        const result = await enrollmentService.getLicenseeStudentDetail(studentId, req.user, req.locale);

        ResponseHandler.success(res, {
            message: 'Student detail fetched successfully',
            data: result,
        });
    });
}

export const enrollmentController = new EnrollmentController();
export { EnrollmentController };