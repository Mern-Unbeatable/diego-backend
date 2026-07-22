import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { coursePackageService } from './coursePackage.service.js';
import {
    createCoursePackageSchema,
    updateCoursePackageSchema,
    coursePackageQuerySchema,
} from './coursePackage.validation.js';

class CoursePackageController {

    getAll = catchAsync(async (req, res) => {
        const query = coursePackageQuerySchema.parse(req.query);
        const packages = await coursePackageService.getAll(query);
        ResponseHandler.success(res, { message: 'Course packages fetched successfully', data: { packages } });
    });


    getForSelection = catchAsync(async (req, res) => {
        const { type } = req.query;
        if (!['SINGLE_USER', 'COMPANY'].includes(type)) {
            throw new Error('type must be SINGLE_USER or COMPANY');
        }
        const packages = await coursePackageService.listForSelection(type, req.tenantId || req.user?.tenantId);
        ResponseHandler.success(res, { message: 'Packages fetched successfully', data: { packages } });
    });

    getById = catchAsync(async (req, res) => {
        const pkg = await coursePackageService.getById(req.params.id);
        ResponseHandler.success(res, { message: 'Course package fetched successfully', data: { package: pkg } });
    });

    create = catchAsync(async (req, res) => {
        const payload = createCoursePackageSchema.parse(req.body);
        const pkg = await coursePackageService.create(payload, req.user.level, req.user.tenantId);
        ResponseHandler.created(res, { message: 'Course package created successfully', data: { package: pkg } });
    });

    update = catchAsync(async (req, res) => {
        const payload = updateCoursePackageSchema.parse(req.body);
        const pkg = await coursePackageService.update(req.params.id, payload, req.user.level, req.user.tenantId);
        ResponseHandler.updated(res, { message: 'Course package updated successfully', data: { package: pkg } });
    });

    delete = catchAsync(async (req, res) => {
        await coursePackageService.delete(req.params.id, req.user.level, req.user.tenantId);
        ResponseHandler.success(res, { message: 'Course package deleted successfully', data: { id: req.params.id } });
    });
}

export const coursePackageController = new CoursePackageController();