import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { supportTicketService } from './supportTicket.service.js';
import {
    createTicketSchema,
    updateTicketSchema,
    updateTicketStatusSchema,
    ticketQuerySchema,
} from './supportTicket.validation.js';

class SupportTicketController {
    constructor() {
        this.log = new Logger('SupportTicketController');
    }
    getMyTickets = catchAsync(async (req, res) => {
        const query = ticketQuerySchema.parse(req.query);
        const result = await supportTicketService.getMyTickets(
            req.user.id,
            query,
            req.locale,
            req.user,
        );

        ResponseHandler.success(res, {
            message: 'My tickets fetched successfully',
            data: result
        });
    });

    getAllTickets = catchAsync(async (req, res) => {
        const query = ticketQuerySchema.parse(req.query);
        const result = await supportTicketService.getAllTickets(
            query,
            req.locale,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Tickets fetched successfully',
            data: result
        });
    });

    getTicketById = catchAsync(async (req, res) => {
        const ticket = await supportTicketService.getTicketById(
            req.params.id,
            req.locale,
            req.user
        );

        if (!ticket) throw new Error('Ticket not found');

        ResponseHandler.success(res, {
            message: 'Ticket fetched successfully',
            data: { ticket }
        });
    });

    createTicket = catchAsync(async (req, res) => {
        const payload = createTicketSchema.parse(req.body);
        const ticket = await supportTicketService.createTicket(
            payload,
            req.user.id
        );

        this.log.info(`Ticket created: ${ticket.id} by user ${req.user.id}`);
        ResponseHandler.created(res, {
            message: 'Ticket created successfully',
            data: { ticket }
        });
    });

    updateTicket = catchAsync(async (req, res) => {
        const payload = updateTicketSchema.parse(req.body);

        const ticket = await supportTicketService.updateTicket(
            req.params.id,
            payload,
            req.user.id
        );

        this.log.info(`Ticket updated: ${req.params.id} by admin ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Ticket updated successfully',
            data: { ticket }
        });
    });

    updateTicketStatus = catchAsync(async (req, res) => {
        const payload = updateTicketStatusSchema.parse(req.body);

        const ticket = await supportTicketService.updateTicketStatus(
            req.params.id,
            payload.status,
            req.user.id
        );

        this.log.info(`Ticket status updated: ${req.params.id} to ${payload.status} by admin ${req.user.id}`);
        ResponseHandler.updated(res, {
            message: 'Ticket status updated successfully',
            data: { ticket }
        });
    });


    deleteTicket = catchAsync(async (req, res) => {
        const deleted = await supportTicketService.deleteTicket(
            req.params.id,
            req.user.id
        );

        this.log.info(`Ticket deleted: ${req.params.id} by admin ${req.user.id}`);
        ResponseHandler.success(res, {
            message: 'Ticket deleted successfully',
            data: {
                ticketId: deleted.id,
                subject: deleted.subject,
                userId: deleted.userId,
                deletedAt: new Date().toISOString()
            }
        });
    });
}

export const supportTicketController = new SupportTicketController();
export { SupportTicketController };