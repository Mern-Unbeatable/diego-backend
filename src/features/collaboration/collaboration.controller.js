import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { collaborationService } from './collaboration.service.js';
import {
    createCollaborationSchema,
    updateCollaborationSchema,

} from './collaboration.validation.js';

class CollaborationController {
    constructor() {
        this.log = new Logger('CollaborationController');
    }

    createCollaboration = catchAsync(async (req, res) => {
        const payload = createCollaborationSchema.parse(req.body);

        const collaboration = await collaborationService.createCollaboration(
            payload,
            {
                user: req.user || null,
                tenantId: req.tenantId || null,
            }
        );

        this.log.info(`Collaboration created: ${collaboration.id} from ${collaboration.email}`);
        ResponseHandler.created(res, {
            message: 'Collaboration request submitted successfully! We will contact you soon.',
            data: {
                collaboration: {
                    id: collaboration.id,
                    companyName: collaboration.companyName,
                    contactName: collaboration.contactName,
                    email: collaboration.email,
                    collaborationType: collaboration.collaborationType,
                    status: collaboration.status,
                    createdAt: collaboration.createdAt,
                }
            }
        });
    });

    getAllCollaborations = catchAsync(async (req, res) => {
        const result = await collaborationService.getAllCollaborations(
            req.query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Collaborations retrieved successfully',
            data: result
        });
    });

    getCollaborationById = catchAsync(async (req, res) => {
        const { id } = req.params;
        const collaboration = await collaborationService.getCollaborationById(
            id,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Collaboration retrieved successfully',
            data: { collaboration }
        });
    });

    deleteCollaboration = catchAsync(async (req, res) => {
        const { id } = req.params;
        const result = await collaborationService.deleteCollaboration(
            id,
            req.user
        );

        this.log.info(`Collaboration deleted: ${id} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { collaborationId: id }
        });
    });

    updateCollaborationStatus = catchAsync(async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            throw new Error('Status is required');
        }

        const collaboration = await collaborationService.updateCollaborationStatus(
            id,
            status,
            req.user
        );

        this.log.info(`Collaboration status updated: ${id} to ${status} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Collaboration status updated successfully',
            data: { collaboration }
        });
    });


}

export const collaborationController = new CollaborationController();
export { CollaborationController };