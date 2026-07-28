export const STATUS_MAP = {
    completed: 'COMPLETED',
    passed: 'PASSED',
    failed: 'FAILED',
    incomplete: 'INCOMPLETE',
    'not attempted': 'NOT_ATTEMPTED',
    browsed: 'BROWSED',
};

export const STATUS_PRIORITY = {
    PASSED: 5,
    COMPLETED: 4,
    FAILED: 3,
    INCOMPLETE: 2,
    BROWSED: 1,
    NOT_ATTEMPTED: 0,
    UNKNOWN: 0,
};