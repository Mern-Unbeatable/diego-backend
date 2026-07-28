// features/package/package.controller.js
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { packageService } from './package.service.js';
import {
    createPackageSchema,
    updatePackageSchema,
    packageQuerySchema,
} from './package.validation.js';

class PackageController {
    constructor() {
        this.log = new Logger('PackageController');
    }


    getAllPackages = catchAsync(async (req, res) => {
        const query = packageQuerySchema.parse(req.query);
        const result = await packageService.getAllPackages(
            query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Packages fetched successfully',
            data: result
        });
    });

    getPackageById = catchAsync(async (req, res) => {
        const packageData = await packageService.getPackageById(
            req.params.id,
            req.locale,
            req.user
        );

        if (!packageData) throw new Error('Package not found');

        ResponseHandler.success(res, {
            message: 'Package fetched successfully',
            data: { package: packageData }
        });
    });

    getPackageBySlug = catchAsync(async (req, res) => {
        const packageData = await packageService.getPackageBySlug(
            req.params.slug,
            req.locale,
            req.user
        );

        if (!packageData) throw new Error('Package not found');

        ResponseHandler.success(res, {
            message: 'Package fetched successfully',
            data: { package: packageData }
        });
    });


    createPackage = catchAsync(async (req, res) => {
        const payload = createPackageSchema.parse(req.body);

        const packageData = await packageService.createPackage(
            payload,
            req.user.id
        );

        this.log.info(`Package created: ${packageData.id} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Package created successfully',
            data: { package: packageData }
        });
    });


    updatePackage = catchAsync(async (req, res) => {
        const payload = updatePackageSchema.parse(req.body);

        const packageData = await packageService.updatePackage(
            req.params.id,
            payload,
            req.user.id
        );

        this.log.info(`Package updated: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Package updated successfully',
            data: { package: packageData }
        });
    });

    deletePackage = catchAsync(async (req, res) => {
        const deleted = await packageService.deletePackage(
            req.params.id,
            req.user.id
        );

        this.log.info(`Package deleted: ${req.params.id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Package deleted successfully',
            data: {
                packageId: deleted.id,
                slug: deleted.slug,
                deletedAt: new Date().toISOString()
            }
        });
    });


    toggleActive = catchAsync(async (req, res) => {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            throw new Error('isActive (boolean) is required');
        }

        const result = await packageService.toggleActive(
            req.params.id,
            isActive,
            req.user.id
        );

        ResponseHandler.updated(res, {
            message: `Package ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: { package: result }
        });
    });


    getPackageStats = catchAsync(async (req, res) => {
        const stats = await packageService.getPackageStats(
            req.params.id,
            req.user.id
        );

        ResponseHandler.success(res, {
            message: 'Package statistics fetched',
            data: { stats }
        });
    });
}

export const packageController = new PackageController();
export { PackageController };