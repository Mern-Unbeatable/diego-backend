export const PLATFORM_SETTING_KEYS = {
    DOWNLOAD_PERMISSION: 'downloadPermissionEnabled',
    NEW_USER_REGISTRATION: 'newUserRegistrationEnabled',
    PAYMENT_PROCESSING: 'paymentProcessingEnabled',
    MAINTENANCE_MODE: 'maintenanceModeEnabled',
};

export const DEFAULT_PLATFORM_SETTINGS = {
    downloadPermissionEnabled: true,
    newUserRegistrationEnabled: true,
    paymentProcessingEnabled: true,
    maintenanceModeEnabled: false,
    maintenanceMessage: null,
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
