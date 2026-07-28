import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { contactService } from './contact.service.js';
import {
    createContactSchema,
    updateContactSchema,
    updateContactStatusSchema,
} from './contact.validation.js';

class ContactController {
    constructor() {
        this.log = new Logger('ContactController');
    }

    createContact = catchAsync(async (req, res) => {
        const payload = createContactSchema.parse(req.body);

        const contact = await contactService.createContact(
            payload,
            {
                user: req.user || null,
                tenantId: req.tenantId || null,
            }
        );

        this.log.info(`Contact created: ${contact.id} from ${contact.email}`);

        ResponseHandler.created(res, {
            message: 'Messaggio inviato con successo! Ti contatteremo presto.',
            data: {
                contact: {
                    id: contact.id,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    email: contact.email,
                    phone: contact.phone,
                    status: contact.status,
                    createdAt: contact.createdAt,
                    agencyName: contact.agencyName,
                }
            }
        });
    });

    getAllContacts = catchAsync(async (req, res) => {
        const result = await contactService.getAllContacts(
            req.query,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Contatti recuperati con successo',
            data: result
        });
    });

    getContactById = catchAsync(async (req, res) => {
        const { id } = req.params;
        const contact = await contactService.getContactById(
            id,
            req.user
        );

        ResponseHandler.success(res, {
            message: 'Contatto recuperato con successo',
            data: { contact }
        });
    });

    updateContact = catchAsync(async (req, res) => {
        const { id } = req.params;
        const payload = updateContactSchema.parse(req.body);

        const contact = await contactService.updateContact(
            id,
            payload,
            req.user
        );

        this.log.info(`Contact updated: ${id} by ${req.user?.id || 'anonymous'}`);

        ResponseHandler.updated(res, {
            message: 'Contatto aggiornato con successo',
            data: { contact }
        });
    });

    // ✅ NEW: Update Contact Status
    updateStatus = catchAsync(async (req, res) => {
        const { id } = req.params;
        const { status } = updateContactStatusSchema.parse(req.body);

        const result = await contactService.updateContactStatus(
            id,
            status,
            req.user
        );

        ResponseHandler.success(res, {
            message: `Stato contatto aggiornato da "${result.previousStatus}" a "${result.newStatus}"`,
            data: result
        });
    });

    deleteContact = catchAsync(async (req, res) => {
        const { id } = req.params;
        const result = await contactService.deleteContact(
            id,
            req.user
        );

        this.log.info(`Contact deleted: ${id} by ${req.user?.id || 'anonymous'}`);

        ResponseHandler.success(res, {
            message: result.message,
            data: { contactId: id }
        });
    });
}

export const contactController = new ContactController();
export { ContactController };