export const PLATFORM_FEE_PERCENT = 20;

export const INCOME_CATEGORIES = {
    PLATFORM_LICENSE: 'PLATFORM_LICENSE',
    PLATFORM_COURSE: 'PLATFORM_COURSE',
    PLATFORM_ARCHIVE: 'PLATFORM_ARCHIVE',
    PLATFORM_PACKAGE: 'PLATFORM_PACKAGE',
    LICENSE_USER_COURSE: 'LICENSE_USER_COURSE',
};

export const CHART_PERIOD_OPTIONS = [7, 30, 90];

export const CHART_SERIES_OPTIONS = {
    it: [
        { key: 'current', label: 'Corrente' },
        { key: 'previous', label: 'Periodo precedente' },
        { key: 'both', label: 'Entrambi' },
    ],
    en: [
        { key: 'current', label: 'Current' },
        { key: 'previous', label: 'Previous Period' },
        { key: 'both', label: 'Both' },
    ],
    fr: [
        { key: 'current', label: 'Actuel' },
        { key: 'previous', label: 'Période précédente' },
        { key: 'both', label: 'Les deux' },
    ],
    zh: [
        { key: 'current', label: '当前' },
        { key: 'previous', label: '上一周期' },
        { key: 'both', label: '两者' },
    ],
};
