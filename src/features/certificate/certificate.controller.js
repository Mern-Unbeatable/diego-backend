
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { certificateService } from './certificate.service.js';
import {
    generateCertificateSchema,
    updateCertificateSchema,
    verifyCertificateSchema,
    certificateQuerySchema,
} from './certificate.validation.js';

class CertificateController {
    constructor() {
        this.log = new Logger('CertificateController');
    }

    getMyCertificates = catchAsync(async (req, res) => {
        const query = certificateQuerySchema.parse(req.query);

        const result = await certificateService.getMyCertificates(
            req.user.id,
            query,
            req.locale
        );

        ResponseHandler.success(res, {
            message: 'My certificates fetched successfully',
            data: result
        });
    });

    getArchivePlan = catchAsync(async (req, res) => {
        const status = await certificateService.getArchiveStatus(req.user.id, req.locale);
        ResponseHandler.success(res, {
            message: 'Archive plan fetched',
            data: status,
        });
    });

    getAllCertificates = catchAsync(async (req, res) => {
        const query = certificateQuerySchema.parse(req.query);

        const result = await certificateService.getAllCertificates(
            query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Certificates fetched successfully',
            data: result
        });
    });

    getCertificateById = catchAsync(async (req, res) => {
        const certificate = await certificateService.getCertificateById(
            req.params.id,
            req.locale,
            req.user
        );

        if (!certificate) throw new Error('Certificate not found');

        ResponseHandler.success(res, {
            message: 'Certificate fetched successfully',
            data: { certificate }
        });
    });
    generateCertificate = catchAsync(async (req, res) => {
        const payload = generateCertificateSchema.parse(req.body);

        const certificate = await certificateService.generateCertificate(
            payload,
            req.user.id
        );

        this.log.info(`Certificate generated: ${certificate.id} by user ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Certificate generated successfully',
            data: { certificate }
        });
    });

    updateCertificate = catchAsync(async (req, res) => {
        const payload = updateCertificateSchema.parse(req.body);

        const certificate = await certificateService.updateCertificate(
            req.params.id,
            payload,
            req.user.id
        );

        this.log.info(`Certificate updated: ${req.params.id} by admin ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Certificate updated successfully',
            data: { certificate }
        });
    });
    downloadCertificate = catchAsync(async (req, res) => {
        const result = await certificateService.downloadCertificate(
            req.params.id,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Certificate download URL generated',
            data: result
        });
    });
    verifyCertificate = catchAsync(async (req, res) => {
        const { certificateId } = verifyCertificateSchema.parse(req.params);

        const result = await certificateService.verifyCertificate(certificateId);

        ResponseHandler.success(res, {
            message: result.valid ? 'Certificate is valid' : 'Certificate verification failed',
            data: result
        });
    });

    deleteCertificate = catchAsync(async (req, res) => {
        const deleted = await certificateService.deleteCertificate(
            req.params.id,
            req.user.id
        );

        this.log.info(`Certificate deleted: ${req.params.id} by admin ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Certificate deleted successfully',
            data: {
                certificateId: deleted.id,
                userId: deleted.userId,
                courseId: deleted.courseId,
                deletedAt: new Date().toISOString()
            }
        });
    });
}

export const certificateController = new CertificateController();
export { CertificateController };