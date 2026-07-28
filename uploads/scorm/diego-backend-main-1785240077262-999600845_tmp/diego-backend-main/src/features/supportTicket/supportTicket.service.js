import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';

const TICKET_I18N_KEYS = ['answer', 'question'];

export class SupportTicketService {

    async getAllTickets(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = {};
        const userLevel = user?.level;
        const userId = user?.id;

        // ── Permission Filtering ──
        if (userLevel === 'PLATFORM_ADMIN') {
            // Admin sees all tickets
            if (queryParams.userId) {
                where.userId = queryParams.userId;
            }
        } else if (userLevel === 'LICENSEE') {
            const licenseeUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { tenantId: true }
            });
            if (licenseeUser?.tenantId) {
                const tenantUsers = await prisma.user.findMany({
                    where: { tenantId: licenseeUser.tenantId },
                    select: { id: true }
                });
                const userIds = tenantUsers.map(u => u.id);
                where.userId = { in: userIds };
            }
        } else if (userLevel === 'COMPANY_ADMIN' || userLevel === 'COMPANY_EMPLOYEE') {

            const companyUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { companyId: true }
            });
            if (companyUser?.companyId) {
                const companyUsers = await prisma.user.findMany({
                    where: { companyId: companyUser.companyId },
                    select: { id: true }
                });
                const userIds = companyUsers.map(u => u.id);
                where.userId = { in: userIds };
            }
        } else {

            where.userId = userId;
        }

        // ── Filters ──
        if (queryParams.status) {
            where.status = queryParams.status;
        }

        if (queryParams.search) {
            where.OR = [
                { subject: { contains: queryParams.search, mode: 'insensitive' } },
                { message: { contains: queryParams.search, mode: 'insensitive' } },
                { answer: { path: ['it'], string_contains: queryParams.search } },
                { answer: { path: ['en'], string_contains: queryParams.search } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc'
        };

        const [tickets, total] = await Promise.all([
            prisma.supportTicket.findMany({
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
                            tenantId: true,
                            companyId: true,
                        }
                    },
                    tenant: {
                        select: {
                            id: true,
                            name: true,
                        }
                    }
                }
            }),
            prisma.supportTicket.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            tickets: tickets.map(ticket => ({
                id: ticket.id,
                subject: ticket.subject,
                message: ticket.message,
                question: ticket.question,
                answer: localizeObject(ticket.answer, locale, TICKET_I18N_KEYS),
                status: ticket.status,
                attachments: ticket.attachments,
                user: {
                    id: ticket.user.id,
                    name: `${ticket.user.firstName || ''} ${ticket.user.lastName || ''}`.trim(),
                    email: ticket.user.email,
                    level: ticket.user.level,
                },
                tenant: ticket.tenant ? {
                    id: ticket.tenant.id,
                    name: ticket.tenant.name,
                } : null,
                createdAt: ticket.createdAt,
                updatedAt: ticket.updatedAt,
            })),
        };
    }

    async getTicketById(id, locale = 'it', user = null) {
        const ticket = await prisma.supportTicket.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        level: true,
                        tenantId: true,
                        companyId: true,
                    }
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            }
        });

        if (!ticket) return null;

        // ── Check Permission ──
        await this._checkViewPermission(ticket, user);

        return {
            id: ticket.id,
            subject: ticket.subject,
            message: ticket.message,
            question: ticket.question,
            answer: localizeObject(ticket.answer, locale, TICKET_I18N_KEYS),
            status: ticket.status,
            attachments: ticket.attachments,
            user: {
                id: ticket.user.id,
                name: `${ticket.user.firstName || ''} ${ticket.user.lastName || ''}`.trim(),
                email: ticket.user.email,
                level: ticket.user.level,
            },
            tenant: ticket.tenant ? {
                id: ticket.tenant.id,
                name: ticket.tenant.name,
            } : null,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
        };
    }

    async createTicket(data, userId) {
        const { subject, message, question, attachments } = data;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                tenantId: true,
                level: true,
                companyId: true,
            }
        });
        if (!user) throw new Error('User not found');

        if (user.level === 'PRIVATE_USER' && !user.tenantId && !user.companyId) {
        }

        return prisma.supportTicket.create({
            data: {
                userId,
                subject,
                message,
                question: question || null,
                attachments: attachments || null,
                tenantId: user.tenantId || null,
                status: 'OPEN',
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    }
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            }
        });
    }

    async updateTicket(id, data, userId) {
        const { answer, question, status } = data;

        const existing = await prisma.supportTicket.findUnique({
            where: { id },
            select: { id: true, userId: true, tenantId: true }
        });
        if (!existing) throw new Error('Ticket not found');
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true }
        });

        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only admin can update tickets');
        }

        const updateData = {
            ...(answer && { answer }),
            ...(question && { question }),
            ...(status && { status }),
        };
        if (answer && !status) {
            updateData.status = 'IN_PROGRESS';
        }

        return prisma.supportTicket.update({
            where: { id },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    }
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            }
        });
    }

    async updateTicketStatus(id, status, userId) {
        const existing = await prisma.supportTicket.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!existing) throw new Error('Ticket not found');
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true }
        });

        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only admin can update ticket status');
        }

        return prisma.supportTicket.update({
            where: { id },
            data: { status },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    }
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            }
        });
    }


    async deleteTicket(id, userId) {
        const existing = await prisma.supportTicket.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!existing) throw new Error('Ticket not found');
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true }
        });

        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only admin can delete tickets');
        }

        return prisma.supportTicket.delete({
            where: { id },
            select: {
                id: true,
                subject: true,
                userId: true,
                deletedAt: true,
            }
        });
    }

    async _checkViewPermission(ticket, user) {
        if (!user) throw new Error('Authentication required');

        const userLevel = user.level;
        const userId = user.id;
        if (userLevel === 'PLATFORM_ADMIN') return;
        if (ticket.userId === userId) return;
        if (userLevel === 'LICENSEE') {
            const licenseeUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { tenantId: true }
            });
            if (licenseeUser?.tenantId === ticket.tenantId) return;
        }
        if (userLevel === 'COMPANY_ADMIN' || userLevel === 'COMPANY_EMPLOYEE') {
            const companyUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { companyId: true }
            });
            const ticketUser = await prisma.user.findUnique({
                where: { id: ticket.userId },
                select: { companyId: true }
            });
            if (companyUser?.companyId && companyUser.companyId === ticketUser?.companyId) {
                return;
            }
        }

        throw new Error('Permission denied: You cannot view this ticket');
    }
    async getMyTickets(userId, queryParams = {}, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId };

        if (queryParams.status) {
            where.status = queryParams.status;
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc'
        };

        const [tickets, total] = await Promise.all([
            prisma.supportTicket.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    tenant: {
                        select: {
                            id: true,
                            name: true,
                        }
                    }
                }
            }),
            prisma.supportTicket.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            tickets: tickets.map(ticket => ({
                id: ticket.id,
                subject: ticket.subject,
                message: ticket.message,
                question: ticket.question,
                answer: localizeObject(ticket.answer, locale, TICKET_I18N_KEYS),
                status: ticket.status,
                attachments: ticket.attachments,
                tenant: ticket.tenant ? {
                    id: ticket.tenant.id,
                    name: ticket.tenant.name,
                } : null,
                createdAt: ticket.createdAt,
                updatedAt: ticket.updatedAt,
            })),
        };
    }
}

export const supportTicketService = new SupportTicketService();