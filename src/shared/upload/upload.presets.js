import { createUploadMiddleware, parseJsonFields } from './index.js';

export const uploadCourseFiles = createUploadMiddleware([
    { name: 'thumbnailUrl', folder: 'courses/thumbnails', type: 'image', maxCount: 1, maxSizeMB: 10 },
    { name: 'documentUrl', folder: 'courses/documents', type: 'document', maxCount: 1, maxSizeMB: 25 },
    { name: 'scormPackageUrl', folder: 'courses/scorm', type: 'zip', maxCount: 1, maxSizeMB: 500 },
    { name: 'videoUrl', folder: 'courses/videos', type: 'video', maxCount: 1, maxSizeMB: 500 },
]);

export const parseCourseJsonFields = (req, res, next) => {
    const jsonFields = [
        'courseTitle', 'trainingPlanTitle', 'description', 'financingCompany',
        'type', 'courseLocation', 'selectType', 'sector', 'fund',
        'methodology', 'trainingProjectManager', 'tutorName', 'vat',
        'lessons',


        'singleUserPackageTitle',
        'singleUserFeatures',
        'companyPackageTitle',
        'companyPackageDescription',
        'companyFeatures',
        'courseFeatures',
        'code',
        'pricingTiers',
    ];

    for (const field of jsonFields) {
        if (req.body[field] !== undefined && typeof req.body[field] === 'string') {
            const trimmed = req.body[field].trim();
            if (trimmed === '') {
                delete req.body[field];
                continue;
            }
            try {
                req.body[field] = JSON.parse(trimmed);
            } catch (err) {
                return res.status(400).json({
                    status: 'error',
                    statusCode: 400,
                    message: `Invalid JSON in field "${field}": ${err.message}`,
                });
            }
        }
    }

    next();
};

export const uploadUserAvatar = createUploadMiddleware([
    {
        name: 'avatar',
        folder: 'users/avatars',
        type: 'image',
        maxCount: 1,
        maxSizeMB: 5
    },
]);

export const uploadLessonFiles = createUploadMiddleware([
    { name: 'contentUrl', folder: 'lessons/files', type: 'any', maxCount: 1, maxSizeMB: 200 },
    { name: 'scormPackageUrl', folder: 'lessons/scorm', type: 'zip', maxCount: 1, maxSizeMB: 500 },
]);

export const parseLessonJsonFields = parseJsonFields(['title', 'question', 'answer']);


export const uploadCompanyLogo = createUploadMiddleware([
    { name: 'logoUrl', folder: 'companies/logos', type: 'image', maxCount: 1, maxSizeMB: 5 },
]);


export const uploadTenantFiles = createUploadMiddleware([
    { name: 'logoUrl', folder: 'tenants/logos', type: 'image', maxCount: 1, maxSizeMB: 5 },
]);

export const uploadTicketFiles = createUploadMiddleware([
    {
        name: 'attachments',
        folder: 'tickets/attachments',
        type: 'image',
        maxCount: 1,
        maxSizeMB: 5,
        required: false
    },
]);
export const uploadCertificateFiles = createUploadMiddleware([
    {
        name: 'companyLogoUrl',
        folder: 'certificates/companyLogoUrl',
        type: 'image',
        maxCount: 1,
        maxSizeMB: 5,
        required: false
    },
]);


export const uploadStaffDocumentFile = createUploadMiddleware([
    {
        name: 'file',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: true,
    },
]);

export const uploadStaffCreateDocuments = createUploadMiddleware([
    {
        name: 'CURRICULUM',
        targetField: 'CURRICULUM',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'documents[CURRICULUM]',
        targetField: 'CURRICULUM',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'HEALTH_SAFETY_CERTIFICATE',
        targetField: 'HEALTH_SAFETY_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'documents[HEALTH_SAFETY_CERTIFICATE]',
        targetField: 'HEALTH_SAFETY_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'DIGITAL_SKILLS_CERTIFICATE',
        targetField: 'DIGITAL_SKILLS_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'documents[DIGITAL_SKILLS_CERTIFICATE]',
        targetField: 'DIGITAL_SKILLS_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'IDENTITY_CARD_TAX_CODE',
        targetField: 'IDENTITY_CARD_TAX_CODE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'documents[IDENTITY_CARD_TAX_CODE]',
        targetField: 'IDENTITY_CARD_TAX_CODE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'CHAMBER_OF_COMMERCE_CERTIFICATE',
        targetField: 'CHAMBER_OF_COMMERCE_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
    {
        name: 'documents[CHAMBER_OF_COMMERCE_CERTIFICATE]',
        targetField: 'CHAMBER_OF_COMMERCE_CERTIFICATE',
        folder: 'staff/documents',
        type: 'document',
        maxCount: 1,
        maxSizeMB: 15,
        required: false,
    },
]);


export const uploadServiceRequestFiles = createUploadMiddleware([
    {
        name: 'documents',
        folder: 'service-requests/documents',
        type: 'document',
        maxCount: 10,
        maxSizeMB: 25,
        required: false,
    },
]);