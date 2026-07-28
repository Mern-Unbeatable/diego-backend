import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { Logger } from '../../config/logger.js';
import { SERVICE_REQUEST_STATUSES } from './serviceRequest.config.js';

const log = new Logger('ServiceRequestService');

export class ServiceRequestService {

    async createServiceRequest(payload, uploadedFiles, meta) {
        const {

            serviceName,
            firstName,
            lastName,
            companyName,
            vatNumber,
            phone,
            email,
            message,

        } = payload;

        const documents = uploadedFiles.length > 0
            ? JSON.stringify(uploadedFiles)
            : null;

        const data = {
            serviceName: serviceName,
            firstName,
            lastName,
            companyName: companyName || null,
            vatNumber: vatNumber || null,
            phone,
            email,
            message: message || null,
            status: 'NEW',
            documents,
            userId: meta.userId || null,
            tenantId: meta.tenantId || null,
        };

        const serviceRequest = await prisma.serviceRequest.create({
            data,
        });

        return this._formatServiceRequest(serviceRequest);
    }
    async getAllServiceRequests(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = {};
        if (queryParams.status) {
            where.status = queryParams.status;
        }

        if (queryParams.search) {
            where.OR = [
                { firstName: { contains: queryParams.search, mode: 'insensitive' } },
                { lastName: { contains: queryParams.search, mode: 'insensitive' } },
                { email: { contains: queryParams.search, mode: 'insensitive' } },
                { phone: { contains: queryParams.search, mode: 'insensitive' } },
                { companyName: { contains: queryParams.search, mode: 'insensitive' } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [serviceRequests, total] = await Promise.all([
            prisma.serviceRequest.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            level: true,
                        },
                    },
                    tenant: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),
            prisma.serviceRequest.count({ where }),
        ]);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            serviceRequests: serviceRequests.map((sr) =>
                this._formatServiceRequest(sr, locale)
            ),
        };
    }

    async getServiceRequestById(id, locale = 'it', user = null) {
        const serviceRequest = await prisma.serviceRequest.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        level: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        if (!serviceRequest) {
            throw new Error('Service request not found');
        }

        if (!user || user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only Platform Admin can view service request details');
        }

        return this._formatServiceRequest(serviceRequest, locale);
    }

    async updateServiceRequestStatus(id, payload, user) {
        const { status, adminNote } = payload;

        const existing = await prisma.serviceRequest.findUnique({
            where: { id },
            select: { id: true, status: true },
        });

        if (!existing) {
            throw new Error('Service request not found');
        }

        if (!user || user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only Platform Admin can update service requests');
        }

        const updateData = {
            status,
            ...(adminNote !== undefined && { adminNote }),
        };
        if (status !== 'NEW' && existing.status === 'NEW') {
            updateData.handledAt = new Date();
        }

        const updated = await prisma.serviceRequest.update({
            where: { id },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        log.info(`Service request ${id} status updated to ${status} by ${user.id}`);

        return this._formatServiceRequest(updated);
    }

    async deleteServiceRequest(id, user) {
        const existing = await prisma.serviceRequest.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new Error('Service request not found');
        }
        if (!user || user.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only Platform Admin can delete service requests');
        }

        await prisma.serviceRequest.delete({
            where: { id },
        });

        log.info(`Service request ${id} deleted by ${user.id}`);

        return {
            message: 'Service request deleted successfully',
            id,
        };
    }

    _formatServiceRequest(serviceRequest, locale = 'it') {
        let documents = null;
        if (serviceRequest.documents) {
            try {
                documents = typeof serviceRequest.documents === 'string'
                    ? JSON.parse(serviceRequest.documents)
                    : serviceRequest.documents;
            } catch (e) {
                documents = null;
            }
        }

        return {
            id: serviceRequest.id,
            serviceName: serviceRequest.serviceName,
            firstName: serviceRequest.firstName,
            lastName: serviceRequest.lastName,
            companyName: serviceRequest.companyName,
            vatNumber: serviceRequest.vatNumber,
            phone: serviceRequest.phone,
            email: serviceRequest.email,
            message: serviceRequest.message,
            status: serviceRequest.status,
            adminNote: serviceRequest.adminNote,
            handledAt: serviceRequest.handledAt,
            locale: serviceRequest.locale,
            documents,
            user: serviceRequest.user
                ? {
                    id: serviceRequest.user.id,
                    name: `${serviceRequest.user.firstName || ''} ${serviceRequest.user.lastName || ''}`.trim(),
                    email: serviceRequest.user.email,
                    level: serviceRequest.user.level,
                }
                : null,
            tenant: serviceRequest.tenant
                ? {
                    id: serviceRequest.tenant.id,
                    name: serviceRequest.tenant.name,
                }
                : null,
            createdAt: serviceRequest.createdAt,
            updatedAt: serviceRequest.updatedAt,
        };
    }
}

export const serviceRequestService = new ServiceRequestService();
