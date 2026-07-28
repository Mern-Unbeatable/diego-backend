import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { courseService } from './course.service.js';
import {
    createCourseSchema,
    updateCourseSchema,
    courseQuerySchema,
} from './course.validation.js';

class CourseController {
    constructor() {
        this.log = new Logger('CourseController');
    }

    getAllCourses = catchAsync(async (req, res) => {

        const tenantId = req.tenantId;

        const result = await courseService.getAllCourses(req.query, req.locale, req.user, tenantId);

        ResponseHandler.success(res, { message: 'Courses fetched successfully', data: result });
    });

    getCourseById = catchAsync(async (req, res) => {
        const tenantId = req.tenantId;
        const course = await courseService.getCourseById(req.params.id, req.locale, req.user, tenantId);
        if (!course) throw new Error('Course not found');
        ResponseHandler.success(res, { message: 'Course fetched successfully', data: { course } });
    });

    getCourseBySlug = catchAsync(async (req, res) => {
        const tenantId = req.tenantId;
        const course = await courseService.getCourseBySlug(req.params.slug, req.locale, req.user, tenantId);
        if (!course) throw new Error('Course not found');
        ResponseHandler.success(res, { message: 'Course fetched successfully', data: { course } });
    });

    createCourse = catchAsync(async (req, res) => {
        console.log('Request body:', req.body);
        const payload = createCourseSchema.parse(req.body);
        const tenantId = req.tenantId;

        const course = await courseService.createCourse(payload, req.user.id, tenantId);

        this.log.info(`Course created: ${course.id} in tenant ${course.tenantId} by ${req.user.id}`);
        ResponseHandler.created(res, { message: 'Course created successfully', data: { course } });
    });

    updateCourse = catchAsync(async (req, res) => {
        const payload = updateCourseSchema.parse(req.body);

        const course = await courseService.updateCourse(req.params.id, payload, req.user.id, req.user.level);

        this.log.info(`Course updated: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.updated(res, { message: 'Course updated successfully', data: { course } });
    });

    deleteCourse = catchAsync(async (req, res) => {
        const deleted = await courseService.deleteCourse(req.params.id, req.user.id, req.user.level);

        this.log.info(`Course deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Course deleted successfully',
            data: { courseId: deleted.id, deletedAt: new Date().toISOString() },
        });
    });

    toggleActive = catchAsync(async (req, res) => {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') throw new Error('isActive (boolean) is required');

        const result = await courseService.toggleActive(req.params.id, isActive, req.user.id, req.user.level);

        ResponseHandler.updated(res, {
            message: `Course ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: { course: result },
        });
    });

    getCourseStats = catchAsync(async (req, res) => {
        const stats = await courseService.getCourseStats(req.params.id, req.user.id, req.user.level);
        ResponseHandler.success(res, { message: 'Course statistics fetched', data: { stats } });
    });

    getMyCourses = catchAsync(async (req, res) => {
        const query = courseQuerySchema.parse(req.query);
        const tenantId = req.tenantId;

        const result = await courseService.getMyCourses(query, req.locale, req.user, tenantId);

        ResponseHandler.success(res, { message: 'My courses fetched successfully', data: result });
    });

    getPublicCourses = catchAsync(async (req, res) => {

        const result = await courseService.getPublicCourses(req.query, req.locale);
        ResponseHandler.success(res, { message: 'Public courses fetched successfully', data: result });
    });




    assignEmployee = catchAsync(async (req, res) => {
        const { companyCoursePurchaseId, employeeUserId } = req.body;
        if (!companyCoursePurchaseId || !employeeUserId) {
            throw new Error('companyCoursePurchaseId and employeeUserId are required');
        }

        const enrollment = await courseService.assignEmployeeToCompanyCourse({
            companyCoursePurchaseId,
            employeeUserId,
            requestingUserId: req.user.id,
        });

        this.log.info(`Employee ${employeeUserId} assigned to purchase ${companyCoursePurchaseId} by ${req.user.id}`);
        ResponseHandler.created(res, { message: 'Employee assigned successfully', data: { enrollment } });
    });

    removeEmployee = catchAsync(async (req, res) => {
        const { enrollmentId } = req.params;
        await courseService.removeEmployeeFromCompanyCourse({
            enrollmentId,
            requestingUserId: req.user.id,
        });

        this.log.info(`Enrollment ${enrollmentId} removed by ${req.user.id}`);
        ResponseHandler.success(res, { message: 'Employee removed from course successfully', data: { enrollmentId } });
    });
}

export const courseController = new CourseController();
export { CourseController };