
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { assignCourseService } from './assignCourse.service.js';
import {
    assignCourseSchema,
    bulkAssignCourseSchema,
    updateAssignCourseSchema,
    assignCourseQuerySchema,
} from './assignCourse.validation.js';

class AssignCourseController {
    constructor() {
        this.log = new Logger('AssignCourseController');
    }

    getAllAssignments = catchAsync(async (req, res) => {
        const query = assignCourseQuerySchema.parse(req.query);

        const result = await assignCourseService.getAllAssignments(
            query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Assignments fetched successfully',
            data: result
        });
    });


    getMyAssignments = catchAsync(async (req, res) => {
        const assignments = await assignCourseService.getUserAssignments(
            req.user.id,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'My assignments fetched successfully',
            data: { assignments }
        });
    });

    getUserAssignments = catchAsync(async (req, res) => {
        const { userId } = req.params;

        const assignments = await assignCourseService.getUserAssignments(
            userId,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'User assignments fetched successfully',
            data: { assignments }
        });
    });

    assignCourse = catchAsync(async (req, res) => {
        const payload = assignCourseSchema.parse(req.body);

        const assignment = await assignCourseService.assignCourse(
            payload,
            req.user.id
        );

        this.log.info(`Course assigned: ${payload.courseId} to user ${payload.userId} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Course assigned successfully',
            data: { assignment }
        });
    });

    bulkAssignCourse = catchAsync(async (req, res) => {
        const payload = bulkAssignCourseSchema.parse(req.body);

        const result = await assignCourseService.bulkAssignCourse(
            payload,
            req.user.id
        );

        this.log.info(`Bulk assign: ${result.successfullyAssigned} courses assigned by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Bulk assignment completed',
            data: result
        });
    });

    updateAssignment = catchAsync(async (req, res) => {
        const payload = updateAssignCourseSchema.parse(req.body);

        const assignment = await assignCourseService.updateAssignment(
            req.params.id,
            payload,
            req.user.id
        );

        this.log.info(`Assignment updated: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Assignment updated successfully',
            data: { assignment }
        });
    });

    deleteAssignment = catchAsync(async (req, res) => {
        const deleted = await assignCourseService.deleteAssignment(
            req.params.id,
            req.user.id
        );

        this.log.info(`Assignment deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Assignment deleted successfully',
            data: {
                assignmentId: deleted.id,
                userId: deleted.userId,
                courseId: deleted.courseId,
                deletedAt: new Date().toISOString()
            }
        });
    });
}

export const assignCourseController = new AssignCourseController();
export { AssignCourseController };