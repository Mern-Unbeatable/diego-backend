export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const MAX_DOCUMENTS_PER_REQUEST = 10;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',

];

export const SERVICE_REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'RESPONDED', 'CLOSED'];
