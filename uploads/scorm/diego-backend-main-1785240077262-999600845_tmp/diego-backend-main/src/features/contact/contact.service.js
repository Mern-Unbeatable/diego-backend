import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import PrismaQueryBuilder from '../../shared/globals/helpers/query-builder.js';

const log = new Logger('ContactService');


export const CONTACT_STATUS = {
    PENDING: "PENDING",
    CONTACTED: "CONTACTED",
    RESOLVED: "RESOLVED"
};


const VALID_TRANSITIONS = {
    [CONTACT_STATUS.PENDING]: [CONTACT_STATUS.CONTACTED, CONTACT_STATUS.RESOLVED],
    [CONTACT_STATUS.CONTACTED]: [CONTACT_STATUS.RESOLVED],
    [CONTACT_STATUS.RESOLVED]: []
};

export class ContactService {

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

    async createContact(data, context = null) {
        const tenantId = await this._resolveTenantId(context);

        const createData = {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            email: data.email,
            vat: data.vat ?? null,
            agencyName: data.agencyName ?? null,
            message: data.message ?? null,
            status: CONTACT_STATUS.PENDING,
        };

        if (tenantId) {
            createData.tenant = {
                connect: { id: tenantId },
            };
        }

        const contact = await prisma.contact.create({
            data: createData,
        });

        log.info(`Contact created: ${contact.id} from ${contact.email}`);

        return contact;
    }

    async getAllContacts(queryParams = {}, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const queryBuilder = new PrismaQueryBuilder(prisma.contact, queryParams, {
            searchableFields: ['firstName', 'lastName', 'email', 'agencyName'],
            defaultSort: { createdAt: 'desc' },
            defaultLimit: 20,
            maxLimit: 100,
        });

        queryBuilder.search().filter().sort().paginate();
        const queryOptions = queryBuilder.build();

        let finalWhere = queryOptions.where;

        if (queryParams.status) {
            const statusFilter = { status: queryParams.status };
            finalWhere = finalWhere && Object.keys(finalWhere).length > 0
                ? { AND: [statusFilter, finalWhere] }
                : statusFilter;
        }

        if (tenantId) {
            const tenantScope = {
                OR: [
                    { tenantId },
                    { tenantId: null },
                ],
            };

            finalWhere = finalWhere && Object.keys(finalWhere).length > 0
                ? { AND: [tenantScope, finalWhere] }
                : tenantScope;
        }

        const [contacts, total] = await Promise.all([
            prisma.contact.findMany({
                ...queryOptions,
                where: finalWhere,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    vat: true,
                    phone: true,
                    email: true,
                    message: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    tenantId: true,
                    agencyName: true,
                },
            }),
            prisma.contact.count({ where: finalWhere }),
        ]);

        const page = parseInt(queryParams.page) || 1;
        const limit = queryOptions.take || 20;
        const statusCounts = await this.getContactStatusCounts(tenantId);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                filters: {
                    search: queryParams.search || null,
                    status: queryParams.status || null,
                },
                statusCounts,
            },
            contacts: contacts,
        };
    }

    async getContactStatusCounts(tenantId = null) {
        const where = tenantId
            ? {
                OR: [
                    { tenantId },
                    { tenantId: null },
                ],
            }
            : {};

        const [pending, contacted, resolved] = await Promise.all([
            prisma.contact.count({ where: { ...where, status: CONTACT_STATUS.PENDING } }),
            prisma.contact.count({ where: { ...where, status: CONTACT_STATUS.CONTACTED } }),
            prisma.contact.count({ where: { ...where, status: CONTACT_STATUS.RESOLVED } }),
        ]);

        return {
            pending,
            contacted,
            resolved,
            total: pending + contacted + resolved
        };
    }

    async getContactById(id, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const where = tenantId
            ? {
                AND: [
                    { id },
                    {
                        OR: [
                            { tenantId },
                            { tenantId: null },
                        ],
                    },
                ],
            }
            : { id };

        const contact = await prisma.contact.findFirst({
            where,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                vat: true,
                phone: true,
                email: true,
                message: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                tenantId: true,
                agencyName: true,
            },
        });

        if (!contact) throw new Error('Contatto non trovato');

        return contact;
    }

    async updateContact(id, data, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const existing = await prisma.contact.findFirst({
            where: tenantId
                ? {
                    AND: [
                        { id },
                        {
                            OR: [
                                { tenantId },
                                { tenantId: null },
                            ],
                        },
                    ],
                }
                : { id },
            select: {
                id: true,
            },
        });

        if (!existing) throw new Error('Contatto non trovato');

        const updateData = {};

        if (data.firstName !== undefined) updateData.firstName = data.firstName;
        if (data.lastName !== undefined) updateData.lastName = data.lastName;
        if (data.vat !== undefined) updateData.vat = data.vat ?? null;
        if (data.phone !== undefined) updateData.phone = data.phone;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.message !== undefined) updateData.message = data.message ?? null;
        if (data.agencyName !== undefined) updateData.agencyName = data.agencyName ?? null;

        const contact = await prisma.contact.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                vat: true,
                phone: true,
                email: true,
                message: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                agencyName: true,
                tenantId: true,
            },
        });

        log.info(`Contact updated: ${id} by ${user?.id || 'anonymous'}`);

        return contact;
    }

    async updateContactStatus(id, newStatus, user = null) {
        const tenantId = await this._resolveTenantId(user);


        const where = tenantId
            ? {
                AND: [
                    { id },
                    {
                        OR: [
                            { tenantId },
                            { tenantId: null },
                        ],
                    },
                ],
            }
            : { id };

        const contact = await prisma.contact.findFirst({
            where,
            select: {
                id: true,
                status: true,
            },
        });

        if (!contact) {
            throw { statusCode: 404, message: 'Contatto non trovato' };
        }

        // Validate status transition
        const allowedTransitions = VALID_TRANSITIONS[contact.status] || [];
        if (!allowedTransitions.includes(newStatus)) {
            throw {
                statusCode: 400,
                message: `Invalid status transition from "${contact.status}" to "${newStatus}". Allowed: ${allowedTransitions.join(', ') || 'none (final state)'}`
            };
        }

        // Update status
        const updatedContact = await prisma.contact.update({
            where: { id },
            data: { status: newStatus },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                agencyName: true,
            },
        });

        log.info(`Contact status updated: ${id} from "${contact.status}" to "${newStatus}" by ${user?.id || 'anonymous'}`);

        return {
            contact: updatedContact
        };
    }

    async deleteContact(id, user = null) {
        const tenantId = await this._resolveTenantId(user);

        const existing = await prisma.contact.findFirst({
            where: tenantId
                ? {
                    AND: [
                        { id },
                        {
                            OR: [
                                { tenantId },
                                { tenantId: null },
                            ],
                        },
                    ],
                }
                : { id },
            select: { id: true },
        });

        if (!existing) throw new Error('Contatto non trovato');

        await prisma.contact.delete({
            where: { id },
        });

        log.info(`Contact deleted: ${id} by ${user?.id || 'anonymous'}`);
        return {
            success: true,
            message: 'Contatto eliminato con successo',
            contactId: id
        };
    }
}

export const contactService = new ContactService();