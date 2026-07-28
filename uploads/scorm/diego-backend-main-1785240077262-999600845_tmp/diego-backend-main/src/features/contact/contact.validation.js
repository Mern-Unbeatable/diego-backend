import { z } from "zod";


export const ContactStatusEnum = z.enum(["PENDING", "CONTACTED", "RESOLVED"]);

export const createContactSchema = z.object({
    firstName: z.string({
        required_error: "First name is required"
    }).min(1, "First name cannot be empty"),

    lastName: z.string({
        required_error: "Last name is required"
    }).min(1, "Last name cannot be empty"),

    email: z.string({
        required_error: "Email is required"
    }).email("Invalid email format"),

    phone: z.number({
        required_error: "Phone number is required",
        invalid_type_error: "Phone number must be a valid number"
    }).int("Phone number must be an integer")
        .positive("Phone number must be a positive number"),

    vat: z.string().optional().nullable(),

    message: z.string().optional().nullable(),

    agencyName: z.string().optional().nullable()
});



export const updateContactSchema = createContactSchema.optional();

export const updateContactStatusSchema = z.object({
    status: ContactStatusEnum
});