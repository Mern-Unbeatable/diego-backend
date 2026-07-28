import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { serviceRequestService } from './serviceRequest.service.js';
import {
    createServiceRequestSchema,
    serviceRequestParamsSchema,
    serviceRequestQuerySchema,
    updateServiceRequestStatusSchema,
} from './serviceRequest.validation.js';

class ServiceRequestController {
    constructor() {
        this.log = new Logger('ServiceRequestController');
    }

    submitServiceRequest = catchAsync(async (req, res) => {

        const payload = createServiceRequestSchema.parse(req.body);

        const rawFiles = req.uploadedFiles?.documents
            || req.files?.documents
            || (Array.isArray(req.files) ? req.files : []);

        const uploadedFiles = rawFiles.map((file) => ({
            url: file.url ?? `/uploads/service-requests/${file.filename}`,
            originalName: file.originalname,
            mimeType: file.mimeType ?? file.mimetype,
            size: file.size,
        }));

        const meta = {
            userId: req.user?.id,
            tenantId: req.user?.tenantId ?? req.tenantId,
            ipAddress: req.ip,
        };

        const result = await serviceRequestService.createServiceRequest(
            payload,
            uploadedFiles,
            meta
        );

        this.log.info(`Service request submitted: ${result.id}`);
        ResponseHandler.created(res, {
            message: 'Request submitted successfully',
            data: result,
        });
    });

    getAllServiceRequests = catchAsync(async (req, res) => {
        const query = serviceRequestQuerySchema.parse(req.query);
        const result = await serviceRequestService.getAllServiceRequests(
            query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Service requests fetched successfully',
            data: result,
        });
    });

    getServiceRequestById = catchAsync(async (req, res) => {
        const { serviceRequestId } = serviceRequestParamsSchema.parse(req.params);
        const result = await serviceRequestService.getServiceRequestById(
            serviceRequestId,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Service request fetched successfully',
            data: result,
        });
    });

    updateServiceRequestStatus = catchAsync(async (req, res) => {
        const { serviceRequestId } = serviceRequestParamsSchema.parse(req.params);
        const payload = updateServiceRequestStatusSchema.parse(req.body);

        const result = await serviceRequestService.updateServiceRequestStatus(
            serviceRequestId,
            payload,
            req.user
        );

        this.log.info(`Service request ${serviceRequestId} updated by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Service request updated successfully',
            data: result,
        });
    });

    deleteServiceRequest = catchAsync(async (req, res) => {
        const { serviceRequestId } = serviceRequestParamsSchema.parse(req.params);
        const result = await serviceRequestService.deleteServiceRequest(
            serviceRequestId,
            req.user
        );

        this.log.info(`Service request deleted: ${serviceRequestId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { serviceRequestId },
        });
    });
}

export const serviceRequestController = new ServiceRequestController();
export { ServiceRequestController };