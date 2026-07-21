// Central config for the Staff/Personnel dossier feature.
// Drives which upload boxes appear per role, and when a profile can be confirmed.

export const STAFF_ROLE_LABELS = {
    TRAINING_PROJECT_MANAGER: 'Training Project Manager',
    CONTENT_MENTOR_TUTOR: 'Content Mentor/Tutor',
    PROCESS_TUTOR: 'Process Tutor',
    PLATFORM_DEVELOPER: 'Platform Developer',
};

export const STAFF_DOCUMENT_LABELS = {
    CURRICULUM: 'Curriculum',
    HEALTH_SAFETY_CERTIFICATE: 'Certificates/Proof of Experience in Health and Safety',
    DIGITAL_SKILLS_CERTIFICATE: 'Digital Skills Certificates',
    IDENTITY_CARD_TAX_CODE: 'Identity card and tax code',
    CHAMBER_OF_COMMERCE_CERTIFICATE: 'Chamber of Commerce certificate',
};

// Required documents per role — matches the four screenshots you shared.
export const REQUIRED_DOCUMENTS_BY_ROLE = {
    TRAINING_PROJECT_MANAGER: [
        'CURRICULUM',
        'HEALTH_SAFETY_CERTIFICATE',
        'DIGITAL_SKILLS_CERTIFICATE',
    ],
    CONTENT_MENTOR_TUTOR: [
        'CURRICULUM',
        'IDENTITY_CARD_TAX_CODE',
        'HEALTH_SAFETY_CERTIFICATE',
        'DIGITAL_SKILLS_CERTIFICATE',
    ],
    PROCESS_TUTOR: [
        'IDENTITY_CARD_TAX_CODE',
    ],
    PLATFORM_DEVELOPER: [
        'CHAMBER_OF_COMMERCE_CERTIFICATE',
    ],
};


// Roles that use companyName ("Society" field) instead of first/last name
export const COMPANY_TYPE_ROLES = ['PLATFORM_DEVELOPER'];

export function getRequiredDocuments(role) {
    return REQUIRED_DOCUMENTS_BY_ROLE[role] || [];
}

export function isDocumentAllowedForRole(role, documentType) {
    return getRequiredDocuments(role).includes(documentType);
}

export function isCompanyTypeRole(role) {
    return COMPANY_TYPE_ROLES.includes(role);
}