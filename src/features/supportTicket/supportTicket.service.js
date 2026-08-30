import { prisma } from '../../config/db.js';
import { localizeObject, translateAll, translateAllFromEnglish } from '../../shared/services/translate/translate.service.js';

const TICKET_I18N_KEYS = ['answer', 'question'];
const CLOSED_STATUSES = ['CLOSED', 'RESOLVED'];
const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

export class SupportTicketService {

    _sanitizeI18nValue(value, { required = false, fieldName = 'i18n field' } = {}) {
        if (value == null) {
            if (required) throw new Error(`${fieldName} is required`);
            return null;
        }

        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${fieldName} must be an object with locale keys`);
        }

        const sanitized = {};
        for (const locale of SUPPORTED_LOCALES) {
            const raw = value[locale];
            if (typeof raw !== 'string') continue;
            const trimmed = raw.trim();
            if (!trimmed) continue;
            sanitized[locale] = trimmed;
        }

        if (required && Object.keys(sanitized).length === 0) {
            throw new Error(`${fieldName} must include at least one non-empty locale translation`);
        }

        return Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    async _maybeExpandQuestionI18n(question, autoTranslateQuestion = false) {
        if (!question || !autoTranslateQuestion) return question;

        const hasAllLocales = SUPPORTED_LOCALES.every((locale) => typeof question[locale] === 'string' && question[locale].trim());
        if (hasAllLocales) return question;

        if (question.en?.trim()) {
            const translated = await translateAllFromEnglish(question.en.trim());
            return { ...translated, ...question, en: question.en.trim() };
        }

        if (question.it?.trim()) {
            const translated = await translateAll(question.it.trim());
            return { ...translated, ...question, it: question.it.trim() };
        }

        return question;
    }

    _shouldHideClosedTickets(userLevel) {
        return userLevel !== 'PLATFORM_ADMIN';
    }

    _applyStatusFilter(where, queryParams, userLevel) {
        if (queryParams.status) {
            where.status = queryParams.status;
            return;
        }

        if (this._shouldHideClosedTickets(userLevel)) {
            where.status = { notIn: CLOSED_STATUSES };
        }
    }

    _applyPriorityFilter(where, queryParams) {
        if (queryParams.priority) {
            where.priority = queryParams.priority;
        }
    }

    _applySearchFilter(where, search) {
        if (!search?.trim()) return;

        const term = search.trim();
        const ticketNumber = Number(term.replace(/^#/, ''));
        const searchFilters = [
            { subject: { string_contains: term } },
            { message: { string_contains: term } },
            {
                user: {
                    OR: [
                        { firstName: { contains: term, mode: 'insensitive' } },
                        { lastName: { contains: term, mode: 'insensitive' } },
                        { email: { contains: term, mode: 'insensitive' } },
                    ],
                },
            },
        ];

        if (Number.isInteger(ticketNumber) && ticketNumber > 0) {
            searchFilters.push({ ticketNumber });
        }

        where.AND = [...(where.AND || []), { OR: searchFilters }];
    }

    _ticketInclude() {
        return {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    level: true,
                    tenantId: true,
                    companyId: true,
                },
            },
            tenant: {
                select: {
                    id: true,
                    name: true,
                },
            },
        };
    }

    _resolveTicketWhere(idOrNumber) {
        const raw = String(idOrNumber || '').trim();
        const numericValue = Number(raw.replace(/^#/, ''));

        if (/^\d+$/.test(raw.replace(/^#/, '')) && Number.isInteger(numericValue) && numericValue > 0) {
            return { ticketNumber: numericValue };
        }

        return { id: raw };
    }

    _serializeTicket(ticket, locale = 'it') {
        const ticketNumber = ticket.ticketNumber ?? null;

        return {
            id: ticket.id,
            ticketNumber,
            displayId: ticketNumber != null ? `#${ticketNumber}` : null,
            priority: ticket.priority,
            subject: ticket.subject,
            message: ticket.message,
            question: ticket.question,
            answer: localizeObject(ticket.answer, locale, TICKET_I18N_KEYS),
            status: ticket.status,
            attachments: ticket.attachments,
            user: ticket.user
                ? {
                    id: ticket.user.id,
                    name: `${ticket.user.firstName || ''} ${ticket.user.lastName || ''}`.trim(),
                    email: ticket.user.email,
                    level: ticket.user.level,
                }
                : null,
            tenant: ticket.tenant
                ? {
                    id: ticket.tenant.id,
                    name: ticket.tenant.name,
                }
                : null,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
        };
    }

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
        } else if (userLevel === 'LICENSE_USER') {
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
        this._applyStatusFilter(where, queryParams, userLevel);
        this._applyPriorityFilter(where, queryParams);
        this._applySearchFilter(where, queryParams.search);

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc'
        };

        const [tickets, total] = await Promise.all([
            prisma.supportTicket.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: this._ticketInclude(),
            }),
            prisma.supportTicket.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            tickets: tickets.map((ticket) => this._serializeTicket(ticket, locale)),
        };
    }

    async getTicketById(idOrNumber, locale = 'it', user = null) {
        const ticket = await prisma.supportTicket.findFirst({
            where: this._resolveTicketWhere(idOrNumber),
            include: this._ticketInclude(),
        });

        if (!ticket) return null;

        // ── Check Permission ──
        await this._checkViewPermission(ticket, user);

        return this._serializeTicket(ticket, locale);
    }

    async _allocateTicketNumber(tx, ticketId) {
        const locked = await tx.supportTicket.findUnique({
            where: { id: ticketId },
            select: { ticketNumber: true },
        });

        if (locked?.ticketNumber != null) {
            return locked.ticketNumber;
        }

        let ticketNumber;

        try {
            const rows = await tx.$queryRaw`
                SELECT nextval('"SupportTicket_ticketNumber_seq"')::int AS "ticketNumber"
            `;
            ticketNumber = Number(rows?.[0]?.ticketNumber);
        } catch {
            const maxResult = await tx.supportTicket.aggregate({
                _max: { ticketNumber: true },
            });
            ticketNumber = (maxResult._max.ticketNumber ?? 0) + 1;
        }

        if (!Number.isInteger(ticketNumber) || ticketNumber <= 0) {
            throw new Error('Unable to allocate ticket number');
        }

        await tx.supportTicket.update({
            where: { id: ticketId },
            data: { ticketNumber },
        });

        return ticketNumber;
    }

    async createTicket(data, userId) {
        const { subject, message, question, autoTranslateQuestion, attachments } = data;
        const manualQuestion = this._sanitizeI18nValue(question, {
            required: false,
            fieldName: 'question',
        });
        const normalizedQuestion = await this._maybeExpandQuestionI18n(
            manualQuestion,
            autoTranslateQuestion,
        );

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

        const ticket = await prisma.$transaction(async (tx) => {
            const created = await tx.supportTicket.create({
                data: {
                    userId,
                    subject,
                    message,
                    question: normalizedQuestion,
                    attachments: attachments || null,
                    tenantId: user.tenantId || null,
                    status: 'OPEN',
                },
            });

            if (created.ticketNumber == null) {
                await this._allocateTicketNumber(tx, created.id);
            }

            return tx.supportTicket.findUnique({
                where: { id: created.id },
                include: this._ticketInclude(),
            });
        });

        return this._serializeTicket(ticket, 'it');
    }


    async _updateTicketRecord(id, data) {
        return prisma.supportTicket.update({
            where: { id },
            data,
            include: this._ticketInclude(),
        }).then((ticket) => this._serializeTicket(ticket, 'it'));
    }

    async updateTicket(id, data, userId) {
        const { answer, question, status } = data;
        const normalizedAnswer = answer !== undefined
            ? this._sanitizeI18nValue(answer, { required: true, fieldName: 'answer' })
            : undefined;
        const normalizedQuestion = question !== undefined
            ? this._sanitizeI18nValue(question, { required: false, fieldName: 'question' })
            : undefined;

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
            ...(normalizedAnswer !== undefined && { answer: normalizedAnswer }),
            ...(normalizedQuestion !== undefined && { question: normalizedQuestion }),
            ...(status && { status }),
        };
        if (normalizedAnswer && !status) {
            updateData.status = 'IN_PROGRESS';
        }

        return this._updateTicketRecord(id, updateData);
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

        return this._updateTicketRecord(id, { status });
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
                // deletedAt: true,
            }
        });
    }

    async _checkViewPermission(ticket, user) {
        if (!user) throw new Error('Authentication required');

        const userLevel = user.level;
        const userId = user.id;
        if (userLevel === 'PLATFORM_ADMIN') return;
        if (ticket.userId === userId) return;
        if (userLevel === 'LICENSE_USER') {
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
    async getMyTickets(userId, queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId };

        this._applyStatusFilter(where, queryParams, user?.level || 'PRIVATE_USER');
        this._applyPriorityFilter(where, queryParams);
        this._applySearchFilter(where, queryParams.search);

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc'
        };

        const [tickets, total] = await Promise.all([
            prisma.supportTicket.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: this._ticketInclude(),
            }),
            prisma.supportTicket.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            tickets: tickets.map((ticket) => this._serializeTicket(ticket, locale)),
        };
    }
}

export const supportTicketService = new SupportTicketService();