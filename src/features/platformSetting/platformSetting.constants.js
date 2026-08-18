export const PLATFORM_SETTING_KEYS = {
    DOWNLOAD_PERMISSION: 'downloadPermissionEnabled',
    NEW_USER_REGISTRATION: 'newUserRegistrationEnabled',
    PAYMENT_PROCESSING: 'paymentProcessingEnabled',
    MAINTENANCE_MODE: 'maintenanceModeEnabled',
};

export const DEFAULT_CERTIFICATE_ARCHIVE_PLAN = {
    certificateArchiveEnabled: true,
    certificateArchiveName: {
        en: 'Certificate Archive Storage',
        it: 'Archiviazione Attestati',
    },
    certificateArchiveDescription: {
        en: 'Keep and download your training certificates beyond the 30-day free window.',
        it: 'Conserva e scarica i tuoi attestati oltre i 30 giorni gratuiti.',
    },
    certificateArchivePriceEur: 29.99,
    certificateArchiveCurrency: 'EUR',
    certificateArchiveDurationDays: 365,
    certificateArchiveStorageMb: 1024,
    certificateFreeDownloadDays: 30,
    certificateLegalRetentionYears: 5,
};

export const DEFAULT_PLATFORM_SETTINGS = {
    downloadPermissionEnabled: true,
    newUserRegistrationEnabled: true,
    paymentProcessingEnabled: true,
    stripeEnabled: true,
    paypalEnabled: false,
    applePayEnabled: true,
    googlePayEnabled: true,
    defaultCurrency: 'EUR',
    defaultTaxRate: 0,
    maintenanceModeEnabled: false,
    maintenanceMessage: null,
    smtpHost: null,
    smtpPort: null,
    smtpFromEmail: null,
    platformName: null,
    primaryColor: null,
    platformLogoUrl: null,
    emailTemplates: null,
    webhookEndpoints: null,
    ...DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
};

export const EMAIL_TEMPLATE_PLACEHOLDERS = {
    welcome: ['userName'],
    password_reset: ['userName', 'resetLink'],
    course_completion: ['userName', 'courseTitle'],
    payment_confirmation: ['userName', 'amount'],
    license_expiry: ['userName', 'expiryDate'],
};

export const DEFAULT_EMAIL_TEMPLATES = {
    welcome: {
        id: 'welcome',
        name: { it: 'Email di benvenuto', en: 'Welcome email' },
        enabled: true,
        subject: {
            it: 'Benvenuto sulla piattaforma',
            en: 'Welcome to the platform',
        },
        bodyHtml: {
            it: '<p>Ciao {{userName}},</p><p>Benvenuto sulla nostra piattaforma di formazione.</p>',
            en: '<p>Hi {{userName}},</p><p>Welcome to our training platform.</p>',
        },
    },
    password_reset: {
        id: 'password_reset',
        name: { it: 'Reimpostazione password', en: 'Password reset' },
        enabled: true,
        subject: {
            it: 'Reimposta la tua password',
            en: 'Reset your password',
        },
        bodyHtml: {
            it: '<p>Ciao {{userName}},</p><p>Usa questo link per reimpostare la password: {{resetLink}}</p>',
            en: '<p>Hi {{userName}},</p><p>Use this link to reset your password: {{resetLink}}</p>',
        },
    },
    course_completion: {
        id: 'course_completion',
        name: { it: 'Completamento del corso', en: 'Course completion' },
        enabled: true,
        subject: {
            it: 'Corso completato: {{courseTitle}}',
            en: 'Course completed: {{courseTitle}}',
        },
        bodyHtml: {
            it: '<p>Ciao {{userName}},</p><p>Hai completato il corso <strong>{{courseTitle}}</strong>.</p>',
            en: '<p>Hi {{userName}},</p><p>You completed the course <strong>{{courseTitle}}</strong>.</p>',
        },
    },
    payment_confirmation: {
        id: 'payment_confirmation',
        name: { it: 'Conferma del pagamento', en: 'Payment confirmation' },
        enabled: true,
        subject: {
            it: 'Pagamento confermato',
            en: 'Payment confirmed',
        },
        bodyHtml: {
            it: '<p>Ciao {{userName}},</p><p>Il tuo pagamento di {{amount}} è stato confermato.</p>',
            en: '<p>Hi {{userName}},</p><p>Your payment of {{amount}} has been confirmed.</p>',
        },
    },
    license_expiry: {
        id: 'license_expiry',
        name: { it: 'Avviso di scadenza della licenza', en: 'License expiration notice' },
        enabled: true,
        subject: {
            it: 'La tua licenza sta per scadere',
            en: 'Your license is expiring soon',
        },
        bodyHtml: {
            it: '<p>Ciao {{userName}},</p><p>La tua licenza scade il {{expiryDate}}.</p>',
            en: '<p>Hi {{userName}},</p><p>Your license expires on {{expiryDate}}.</p>',
        },
    },
};

export const DEFAULT_BRAND_SETTINGS = {
    platformName: 'One Security',
    primaryColor: '#736FA1',
    platformLogoUrl: null,
};

export const DEFAULT_WEBHOOK_ENDPOINTS = {
    registration: {
        id: 'registration',
        event: 'user.registration',
        name: { it: 'Registrazione utente', en: 'User registration' },
        enabled: true,
        url: '',
    },
    completion: {
        id: 'completion',
        event: 'course.completion',
        name: { it: 'Completamento del corso', en: 'Course completion' },
        enabled: true,
        url: '',
    },
    payment: {
        id: 'payment',
        event: 'payment.success',
        name: { it: 'Pagamento riuscito', en: 'Payment successful' },
        enabled: true,
        url: '',
    },
    license_expiry: {
        id: 'license_expiry',
        event: 'license.expiration',
        name: { it: 'Scadenza della licenza', en: 'License expiration' },
        enabled: true,
        url: '',
    },
};

export const EMERGENCY_CONTROL_LABELS = {
    downloadPermissionEnabled: {
        title: { en: 'Download permission', it: 'Permesso download' },
        description: {
            en: 'Allow users to download certificates.',
            it: 'Consenti agli utenti di scaricare gli attestati.',
        },
    },
    newUserRegistrationEnabled: {
        title: { en: 'New user control panel', it: 'Pannello nuovi utenti' },
        description: {
            en: 'Enable the creation of new user accounts.',
            it: 'Abilita la creazione di nuovi account utente.',
        },
    },
    paymentProcessingEnabled: {
        title: { en: 'Payment processing', it: 'Elaborazione pagamenti' },
        description: {
            en: 'Process subscription and course payments.',
            it: 'Elabora abbonamenti e pagamenti dei corsi.',
        },
    },
    maintenanceModeEnabled: {
        title: { en: 'Platform under maintenance', it: 'Piattaforma in manutenzione' },
        description: {
            en: 'Put the entire platform into maintenance mode.',
            it: 'Metti l\'intera piattaforma in manutenzione.',
        },
    },
};
