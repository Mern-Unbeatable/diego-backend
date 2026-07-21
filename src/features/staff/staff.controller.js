import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { staffService } from './staff.service.js';
import {
    createStaffMemberSchema,
    updateStaffMemberSchema,
    uploadStaffDocumentSchema,
} from './staff.validation.js';

const STAFF_DOCUMENT_TYPES = [
    'CURRICULUM',
    'HEALTH_SAFETY_CERTIFICATE',
    'DIGITAL_SKILLS_CERTIFICATE',
    'IDENTITY_CARD_TAX_CODE',
    'CHAMBER_OF_COMMERCE_CERTIFICATE',
];

class StaffController {
    constructor() {
        this.log = new Logger('StaffController');
    }

    createStaffMember = catchAsync(async (req, res) => {
        const uploadedDocuments = STAFF_DOCUMENT_TYPES
            .map((documentType) => {
                const file = req.uploadedFiles?.[documentType]?.[0]
                    || req.uploadedFiles?.[`documents[${documentType}]`]?.[0];
                if (!file) return null;

                return {
                    documentType,
                    fileUrl: file.url,
                    fileName: file.filename,
                    mimeType: file.mimetype,
                    fileSize: file.size,
                };
            })
            .filter(Boolean);

        const payload = createStaffMemberSchema.parse({
            ...req.body,
            documents: uploadedDocuments,
        });
        const result = await staffService.createStaffMember(payload, req.user);

        this.log.info(`Staff member created: ${result.id} (${result.role}) by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Staff member created successfully',
            data: result,
        });
    });

    getAllStaffMembers = catchAsync(async (req, res) => {

        const result = await staffService.getAllStaffMembers(req.query, req.user);

        ResponseHandler.success(res, {
            message: 'Staff members fetched successfully',
            data: result,
        });
    });

    getStaffMemberById = catchAsync(async (req, res) => {
        const { staffMemberId } = req.params
        const result = await staffService.getStaffMemberById(staffMemberId, req.user);

        ResponseHandler.success(res, {
            message: 'Staff member fetched successfully',
            data: result,
        });
    });

    updateStaffMember = catchAsync(async (req, res) => {
        console.log('req.body in updateStaffMember:', req.body);
        const { staffMemberId } = req.params;
        const payload = updateStaffMemberSchema.parse(req.body);
        const result = await staffService.updateStaffMember(staffMemberId, payload, req.user);

        this.log.info(`Staff member updated: ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Staff member updated successfully',
            data: result,
        });
    });

    deleteStaffMember = catchAsync(async (req, res) => {
        const { staffMemberId } = req.params;
        const result = await staffService.deleteStaffMember(staffMemberId, req.user);

        this.log.info(`Staff member deleted: ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { staffMemberId },
        });
    });

    uploadDocument = catchAsync(async (req, res) => {
        const { staffMemberId, documentType } = req.params;
        const payload = uploadStaffDocumentSchema.parse(req.body);

        const result = await staffService.uploadDocument(staffMemberId, documentType, payload.file, req.user);

        this.log.info(`Document uploaded: ${documentType} for staff ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Document uploaded successfully',
            data: result,
        });
    });


    downloadDocument = catchAsync(async (req, res) => {
        const { staffMemberId, documentType } = req.params;
        const document = await staffService.downloadDocument(staffMemberId, documentType, req.user);

        ResponseHandler.success(res, {
            message: 'Document ready for download',
            data: document,
        });
    });

    deleteDocument = catchAsync(async (req, res) => {
        const { staffMemberId, documentType } = req.params;
        const result = await staffService.deleteDocument(staffMemberId, documentType, req.user);

        this.log.info(`Document deleted: ${documentType} for staff ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { staffMemberId, documentType },
        });
    });

    confirmStaffMember = catchAsync(async (req, res) => {
        const { staffMemberId } = req.params;
        const result = await staffService.confirmStaffMember(staffMemberId, req.user);

        this.log.info(`Staff member confirmed: ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Staff member confirmed successfully',
            data: result,
        });
    });

    cancelStaffMember = catchAsync(async (req, res) => {
        const { staffMemberId } = req.params;
        const result = await staffService.cancelStaffMember(staffMemberId, req.user);

        this.log.info(`Staff member cancelled: ${staffMemberId} by ${req.user.id}`);
        ResponseHandler.success(res, {
            message: result.message,
            data: { staffMemberId },
        });
    });
}

export const staffController = new StaffController();
export { StaffController };