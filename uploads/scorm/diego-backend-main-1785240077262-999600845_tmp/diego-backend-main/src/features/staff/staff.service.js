import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import { getRequiredDocuments, isDocumentAllowedForRole, isCompanyTypeRole } from './staff.config.js';

const log = new Logger('StaffService');

export class StaffService {

    async _resolveTenantId(adminUser) {
        const dbUser = await prisma.user.findUnique({
            where: { id: adminUser.id },
            select: { tenantId: true },
        });
        return dbUser?.tenantId ?? null;
    }

    async createStaffMember(data, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        if (Array.isArray(data.documents)) {
            const invalidDocument = data.documents.find(
                (doc) => !isDocumentAllowedForRole(data.role, doc.documentType)
            );
            if (invalidDocument) {
                throw new Error(
                    `Document type "${invalidDocument.documentType}" is not applicable for role "${data.role}"`
                );
            }
        }

        const staffMember = await prisma.$transaction(async (tx) => {
            const created = await tx.staffMember.create({
                data: {
                    role: data.role,
                    firstName: isCompanyTypeRole(data.role) ? null : data.firstName,
                    lastName: isCompanyTypeRole(data.role) ? null : data.lastName,
                    companyName: isCompanyTypeRole(data.role) ? data.companyName : null,
                    tenantId,
                    createdById: adminUser.id,
                },
            });

            if (Array.isArray(data.documents) && data.documents.length > 0) {
                await tx.staffDocument.createMany({
                    data: data.documents.map((doc) => ({
                        staffMemberId: created.id,
                        documentType: doc.documentType,
                        fileName: doc.fileName,
                        fileUrl: doc.fileUrl,
                        mimeType: doc.mimeType,
                        fileSize: doc.fileSize ?? null,
                    })),
                });
            }

            return tx.staffMember.findUnique({
                where: { id: created.id },
                include: { documents: true },
            });
        });

        if (!staffMember) {
            throw new Error('Failed to create staff member');
        }

        log.info(`Staff member created: ${staffMember.id} (${staffMember.role}) by ${adminUser.id}`);
        return this._withRequirements(staffMember);
    }

    async getAllStaffMembers(queryParams = {}, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { tenantId };
        if (queryParams.role) where.role = queryParams.role;
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.search) {
            where.OR = [
                { firstName: { contains: queryParams.search, mode: 'insensitive' } },
                { lastName: { contains: queryParams.search, mode: 'insensitive' } },
                { companyName: { contains: queryParams.search, mode: 'insensitive' } },
            ];
        }

        const orderBy = { [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };

        const [staffMembers, total] = await Promise.all([
            prisma.staffMember.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: { documents: true },
            }),
            prisma.staffMember.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            staffMembers: staffMembers.map((s) => this._withRequirements(s)),
        };
    }

    async getStaffMemberById(staffMemberId, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
            include: { documents: true },
        });
        if (!staffMember) throw new Error('Staff member not found');

        return this._withRequirements(staffMember);
    }

    async updateStaffMember(staffMemberId, data, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const existing = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
        });
        if (!existing) throw new Error('Staff member not found');

        const updateData = {};
        if (isCompanyTypeRole(existing.role)) {
            if (data.companyName !== undefined) updateData.companyName = data.companyName;
        } else {
            if (data.firstName !== undefined) updateData.firstName = data.firstName;
            if (data.lastName !== undefined) updateData.lastName = data.lastName;
        }

        const updated = await prisma.staffMember.update({
            where: { id: staffMemberId },
            data: updateData,
            include: { documents: true },
        });

        log.info(`Staff member updated: ${staffMemberId} by ${adminUser.id}`);
        return this._withRequirements(updated);
    }

    async deleteStaffMember(staffMemberId, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const existing = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
        });
        if (!existing) throw new Error('Staff member not found');

        // NOTE: if your storage util (used by createUploadMiddleware) needs an
        // explicit delete call for the files on disk/bucket, loop over
        // existing.documents and call it here before deleting the DB row.
        await prisma.staffMember.delete({ where: { id: staffMemberId } });

        log.info(`Staff member deleted: ${staffMemberId} by ${adminUser.id}`);
        return { success: true, message: 'Staff member deleted successfully' };
    }

    // `file` is the uploaded file URL string produced by uploadStaffDocumentFile middleware
    async uploadDocument(staffMemberId, documentType, fileUrl, adminUser) {
        if (!fileUrl) throw new Error('No file provided');

        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
        });
        if (!staffMember) throw new Error('Staff member not found');

        if (!isDocumentAllowedForRole(staffMember.role, documentType)) {
            throw new Error(`Document type "${documentType}" is not applicable for role "${staffMember.role}"`);
        }

        const existingDocument = await prisma.staffDocument.findFirst({
            where: { staffMemberId, documentType },
        });

        const fileName = fileUrl.split('/').pop() || `${documentType}-${Date.now()}`;

        const document = existingDocument
            ? await prisma.staffDocument.update({
                where: { id: existingDocument.id },
                data: {
                    fileUrl,
                    fileName,
                    mimeType: existingDocument.mimeType || 'application/octet-stream',
                    uploadedAt: new Date(),
                },
            })
            : await prisma.staffDocument.create({
                data: {
                    staffMemberId,
                    documentType,
                    fileUrl,
                    fileName,
                    mimeType: 'application/octet-stream',
                    uploadedAt: new Date(),
                },
            });

        // Replacing a document on an already-confirmed profile drops confirmation
        // so master admin has to re-check and re-confirm.
        if (staffMember.status === 'CONFIRMED') {
            await prisma.staffMember.update({
                where: { id: staffMemberId },
                data: { status: 'DRAFT', confirmedAt: null },
            });
        }

        log.info(`Document uploaded: ${documentType} for staff ${staffMemberId} by ${adminUser.id}`);
        return document;
    }

    async downloadDocument(staffMemberId, documentType, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
            select: { id: true },
        });
        if (!staffMember) throw new Error('Staff member not found');

        const document = await prisma.staffDocument.findFirst({
            where: { staffMemberId, documentType },
        });
        if (!document || !document.fileUrl) throw new Error('Document not uploaded yet');

        return document;
    }

    async deleteDocument(staffMemberId, documentType, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
            select: { id: true, status: true },
        });
        if (!staffMember) throw new Error('Staff member not found');

        const document = await prisma.staffDocument.findFirst({
            where: { staffMemberId, documentType },
        });
        if (!document) throw new Error('Document not found');

        await prisma.staffDocument.delete({ where: { id: document.id } });

        if (staffMember.status === 'CONFIRMED') {
            await prisma.staffMember.update({
                where: { id: staffMemberId },
                data: { status: 'DRAFT', confirmedAt: null },
            });
        }

        log.info(`Document deleted: ${documentType} for staff ${staffMemberId} by ${adminUser.id}`);
        return { success: true, message: 'Document deleted successfully' };
    }

    // "He confirms" button
    async confirmStaffMember(staffMemberId, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
            include: { documents: true },
        });
        if (!staffMember) throw new Error('Staff member not found');
        if (staffMember.status === 'CONFIRMED') throw new Error('Staff member is already confirmed');

        const required = getRequiredDocuments(staffMember.role);
        const uploadedTypes = staffMember.documents.filter((d) => d.fileUrl).map((d) => d.documentType);
        const missing = required.filter((docType) => !uploadedTypes.includes(docType));

        if (missing.length > 0) {
            throw new Error(`Cannot confirm: missing required documents: ${missing.join(', ')}`);
        }

        const updated = await prisma.staffMember.update({
            where: { id: staffMemberId },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
            include: { documents: true },
        });

        log.info(`Staff member confirmed: ${staffMemberId} by ${adminUser.id}`);
        return this._withRequirements(updated);
    }

    // "Cancel" button — discards an unconfirmed draft
    async cancelStaffMember(staffMemberId, adminUser) {
        const tenantId = await this._resolveTenantId(adminUser);

        const staffMember = await prisma.staffMember.findFirst({
            where: { id: staffMemberId, tenantId },
        });
        if (!staffMember) throw new Error('Staff member not found');
        if (staffMember.status === 'CONFIRMED') {
            throw new Error('Cannot cancel a confirmed staff profile. Delete it instead.');
        }

        return this.deleteStaffMember(staffMemberId, adminUser);
    }

    _withRequirements(staffMember) {
        const required = getRequiredDocuments(staffMember.role);
        const uploadedTypes = staffMember.documents.filter((d) => d.fileUrl).map((d) => d.documentType);

        return {
            ...staffMember,
            requiredDocuments: required.map((docType) => ({
                documentType: docType,
                uploaded: uploadedTypes.includes(docType),
                document: staffMember.documents.find((d) => d.documentType === docType) || null,
            })),
            completionStatus: {
                totalRequired: required.length,
                totalUploaded: required.filter((docType) => uploadedTypes.includes(docType)).length,
                readyToConfirm: required.every((docType) => uploadedTypes.includes(docType)),
            },
        };
    }
}

export const staffService = new StaffService();