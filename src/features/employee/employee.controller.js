import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { employeeService } from './employee.service.js';
import {
    addEmployeeSchema,
    updateEmployeeSchema,
    employeeQuerySchema,
} from './employee.validation.js';
import { EMPLOYEE_ROLE_SUGGESTIONS } from './employee.constants.js';

class EmployeeController {
    constructor() {
        this.log = new Logger('EmployeeController');
    }

    addEmployee = catchAsync(async (req, res) => {
        const payload = addEmployeeSchema.parse(req.body);
        const result = await employeeService.addEmployee(payload, req.user);

        this.log.info(`Employee added: ${result.employee.email} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: result.emailSent
                ? (result.assignedCoursesCount > 0
                    ? 'Employee added, courses assigned, and login credentials emailed successfully.'
                    : 'Employee added and login credentials emailed successfully.')
                : (result.assignedCoursesCount > 0
                    ? 'Employee added and courses assigned. Email could not be sent — share credentials manually.'
                    : 'Employee added successfully. Email could not be sent — share credentials manually.'),
            data: result,
        });
    });

    getCompanyEmployees = catchAsync(async (req, res) => {
        const query = employeeQuerySchema.parse(req.query);
        const result = await employeeService.getCompanyEmployees(query, req.user);

        ResponseHandler.success(res, {
            message: 'Employees fetched successfully',
            data: result,
        });
    });

    getEmployeeDetail = catchAsync(async (req, res) => {
        const { userId } = req.params;
        const result = await employeeService.getEmployeeDetail(userId, req.user);

        ResponseHandler.success(res, {
            message: 'Employee detail fetched',
            data: result,
        });
    });

    updateEmployee = catchAsync(async (req, res) => {
        const { userId } = req.params;
        const payload = updateEmployeeSchema.parse(req.body);
        const result = await employeeService.updateEmployee(userId, payload, req.user);

        this.log.info(`Employee updated: ${userId} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: result.assignedCoursesCount > 0
                ? 'Employee updated and new course(s) assigned successfully'
                : 'Employee updated successfully',
            data: result,
        });
    });

    getAssignableCourses = catchAsync(async (req, res) => {
        const courses = await employeeService.getAssignableCourses(req.user);

        ResponseHandler.success(res, {
            message: 'Assignable courses fetched successfully',
            data: { courses },
        });
    });

    getRoleSuggestions = catchAsync(async (_req, res) => {
        ResponseHandler.success(res, {
            message: 'Employee role suggestions fetched',
            data: { roles: EMPLOYEE_ROLE_SUGGESTIONS },
        });
    });


    removeEmployee = catchAsync(async (req, res) => {
        const { userId } = req.params;
        const result = await employeeService.removeEmployee(userId, req.user);

        this.log.info(`Employee removed: ${userId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { userId },
        });
    });

    removeEmployeePermanent = catchAsync(async (req, res) => {
        const { userId } = req.params;
        const result = await employeeService.removeEmployeePermanent(userId, req.user);

        this.log.info(`Employee permanently removed: ${userId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: result,
        });
    });
}

export const employeeController = new EmployeeController();