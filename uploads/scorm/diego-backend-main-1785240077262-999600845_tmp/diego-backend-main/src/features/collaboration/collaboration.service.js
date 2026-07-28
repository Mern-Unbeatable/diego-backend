
import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import PrismaQueryBuilder from '../../shared/globals/helpers/query-builder.js';

const log = new Logger('CollaborationService');

export class CollaborationService {

    async _resolveTenantId(context = null) {
        if (!context) return null;

        if (typeof context === 'string') return context;
        if (context.tenantId) return context.tenantId;
        if (context.user?.tenantId) return context.user.tenantId;

        if (context.id) {
            const dbUser = await prisma.user.findUnique({
                where: { id: context.id },
                select: { tenantId: true },
            });
            return dbUser?.tenantId ?? null;
        }

        if (context.user?.id) {
            const dbUser = await prisma.user.findUnique({
                where: { id: context.user.id },
                select: { tenantId: true },
            });
            return dbUser?.tenantId ?? null;
        }

        return null;
    }

    _toResponseShape(collaboration) {
        return {
            id: collaboration.id,
            companyName: collaboration.companyName,
            collaborationType: collaboration.collaborationType,
            contactName: collaboration.contactName,
            email: collaboration.contactEmail,
            telephone: collaboration.contactPhone,
            companySize: collaboration.companySize,
            description: collaboration.businessDescription,
            goals: collaboration.goals,
            status: collaboration.status,
            notes: collaboration.notes,
            createdAt: collaboration.createdAt,
            updatedAt: collaboration.updatedAt,
            tenantId: collaboration.tenantId,
        };
    }

    async createCollaboration(data, context = null) {
        const tenantId = await this._resolveTenantId(context);

        const createData = {
            companyName: data.companyName,
            collaborationType: data.collaborationType,
            contactName: data.contactName,
            contactEmail: data.email,
            contactPhone: data.telephone,
            companySize: data.companySize || null,
            businessDescription: data.description || null,
            status: 'PENDING',
        };

        if (tenantId) {
            createData.tenant = {
                connect: { id: tenantId },
            };
        }

        const collaboration = await prisma.collaborationRequest.create({
            data: createData,
        });

        log.info(`Collaboration created: ${collaboration.id} from ${collaboration.email}`);

        return this._toResponseShape(collaboration);
    }

    async getAllCollaborations(queryParams = {}, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const queryBuilder = new PrismaQueryBuilder(prisma.collaborationRequest, queryParams, {
            searchableFields: ['companyName', 'contactName', 'contactEmail', 'contactPhone'],
            defaultSort: { createdAt: 'desc' },
            defaultLimit: 20,
            maxLimit: 100,
        });

        queryBuilder.search().filter().sort().paginate();
        const queryOptions = queryBuilder.build();

        let finalWhere = queryOptions.where;
        if (tenantId) {
            const tenantScope = {
                OR: [{ tenantId }, { tenantId: null }],
            };
            finalWhere = finalWhere && Object.keys(finalWhere).length > 0
                ? { AND: [tenantScope, finalWhere] }
                : tenantScope;
        }

        const [collaborations, total] = await Promise.all([
            prisma.collaborationRequest.findMany({
                ...queryOptions,
                where: finalWhere,
                select: {
                    id: true,
                    companyName: true,
                    collaborationType: true,
                    contactName: true,
                    contactEmail: true,
                    contactPhone: true,
                    companySize: true,
                    businessDescription: true,
                    goals: true,
                    status: true,
                    notes: true,
                    createdAt: true,
                    updatedAt: true,
                    tenantId: true,
                },
            }),
            prisma.collaborationRequest.count({ where: finalWhere }),
        ]);

        const page = parseInt(queryParams.page) || 1;
        const limit = queryOptions.take || 20;

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),

            },
            collaborations: collaborations.map((item) => this._toResponseShape(item)),
        };
    }

    async getCollaborationById(id, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const where = tenantId
            ? {
                AND: [
                    { id },
                    { OR: [{ tenantId }, { tenantId: null }] },
                ],
            }
            : { id };

        const collaboration = await prisma.collaborationRequest.findFirst({
            where,
            select: {
                id: true,
                companyName: true,
                collaborationType: true,
                contactName: true,
                contactEmail: true,
                contactPhone: true,
                companySize: true,
                businessDescription: true,
                goals: true,
                status: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
                tenantId: true,
            },
        });

        if (!collaboration) throw new Error('Collaboration request not found');

        return this._toResponseShape(collaboration);
    }


    async deleteCollaboration(id, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const existing = await prisma.collaborationRequest.findFirst({
            where: tenantId
                ? {
                    AND: [
                        { id },
                        { OR: [{ tenantId }, { tenantId: null }] },
                    ],
                }
                : { id },
            select: { id: true },
        });

        if (!existing) throw new Error('Collaboration request not found');

        await prisma.collaborationRequest.delete({
            where: { id },
        });

        log.info(`Collaboration deleted: ${id} by ${user?.id || 'anonymous'}`);
        return {
            success: true,
            message: 'Collaboration request deleted successfully',
            collaborationId: id
        };
    }

    async updateCollaborationStatus(id, status, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const existing = await prisma.collaborationRequest.findFirst({
            where: tenantId
                ? {
                    AND: [
                        { id },
                        { OR: [{ tenantId }, { tenantId: null }] },
                    ],
                }
                : { id },
            select: { id: true },
        });

        if (!existing) throw new Error('Collaboration request not found');

        const collaboration = await prisma.collaborationRequest.update({
            where: { id },
            data: { status },
            select: {
                id: true,
                companyName: true,
                collaborationType: true,
                contactName: true,
                contactEmail: true,
                contactPhone: true,
                companySize: true,
                businessDescription: true,
                goals: true,
                status: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
                tenantId: true,
            },
        });

        log.info(`Collaboration status updated: ${id} to ${status} by ${user?.id || 'anonymous'}`);

        return this._toResponseShape(collaboration);
    }
}

export const collaborationService = new CollaborationService();