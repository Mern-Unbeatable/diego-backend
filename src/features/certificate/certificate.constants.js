/** Client spec: free download window after course completion (Utente singolo / pacchetto) */
export const CERTIFICATE_FREE_DOWNLOAD_DAYS = 30;

/** Legal retention on server (Accordo Stato-Regioni — min 5 years) */
export const CERTIFICATE_LEGAL_RETENTION_YEARS = 5;

/** Archive subscription duration after payment */
export const ARCHIVE_SUBSCRIPTION_DAYS = 365;

export const ARCHIVE_STORAGE_MB = 1024;

/** Default annual archive price (EUR) — override via env ARCHIVE_STORAGE_PRICE */
export const ARCHIVE_ANNUAL_PRICE_EUR = Number(process.env.ARCHIVE_STORAGE_PRICE) || 29.99;

export const CERTIFICATE_REMINDER_DAYS = [30, 14, 7, 3, 1];
