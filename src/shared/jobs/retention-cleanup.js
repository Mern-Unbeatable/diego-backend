import cron from 'node-cron';
import { Logger } from '../../config/logger.js';
import { markExpiredFreeDownloadsAsArchived } from '../../features/certificate/certificate.archive.js';
import {
    backfillAntiCheatRetentionDates,
    purgeExpiredAntiCheatLogs,
} from '../services/retention.service.js';

const log = new Logger('RetentionCleanupJob');

const safeJob = (name, fn) => async () => {
    try {
        log.info(`[CRON] Starting job: ${name}`);
        const result = await fn();
        log.info(`[CRON] Finished job: ${name}`, result);
        return result;
    } catch (err) {
        log.error(`[CRON] Job "${name}" failed:`, err.message);
        throw err;
    }
};

export function startRetentionCleanupJob() {
    cron.schedule('0 3 * * *', safeJob('anti_cheat_retention_backfill', backfillAntiCheatRetentionDates));
    cron.schedule('15 3 * * *', safeJob('anti_cheat_retention_purge', purgeExpiredAntiCheatLogs));
    cron.schedule('30 3 * * *', safeJob('certificate_archive_mark_expired', markExpiredFreeDownloadsAsArchived));

    log.info('[CRON] Retention cleanup jobs registered');
}
