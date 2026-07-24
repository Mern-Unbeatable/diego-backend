import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { credentialDeliveryService } from './credentialDelivery.service.js';

class CredentialController {
    getMyCredentials = catchAsync(async (req, res) => {
        const result = await credentialDeliveryService.getMyCredentials(req.user.id, req.query);
        ResponseHandler.success(res, {
            message: 'Credentials fetched successfully',
            data: result,
        });
    });

    markCredentialViewed = catchAsync(async (req, res) => {
        const credential = await credentialDeliveryService.markViewed(req.user.id, req.params.id);
        ResponseHandler.success(res, {
            message: 'Credential marked as viewed',
            data: { credential },
        });
    });
}

export const credentialController = new CredentialController();
