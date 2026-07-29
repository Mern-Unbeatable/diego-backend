import { addYears, subYears } from 'date-fns';
import { prisma } from '../../config/db.js';
import { getArchiveConfig } from '../../features/certificate/certificate.archive.js';

export async function getLegalRetentionYears() {
    const config = await getArchiveConfig();
    return config.legalRetentionYears ?? 5;
}

export async function computeRetentionUntil(fromDate = new Date()) {
    const years = await getLegalRetentionYears();
    return addYears(new Date(fromDate), years);
}

export function isWithinRetentionPeriod(retentionUntil) {
    if (!retentionUntil) return true;
    return new Date(retentionUntil) > new Date();
}

export async function purgeExpiredAntiCheatLogs() {
    const now = new Date();
    const cutoff = subYears(now, await getLegalRetentionYears());

    const result = await prisma.antiCheatLog.deleteMany({
        where: {
            OR: [
                { retentionUntil: { lt: now } },
                {
                    retentionUntil: null,
                    occurredAt: { lt: cutoff },
                },
            ],
        },
    });

    return result.count;
}

export async function backfillAntiCheatRetentionDates() {
    const years = await getLegalRetentionYears();
    const logs = await prisma.antiCheatLog.findMany({
        where: { retentionUntil: null },
        select: { id: true, occurredAt: true },
        take: 5000,
    });

    if (logs.length === 0) return 0;

    await Promise.all(
        logs.map((log) =>
            prisma.antiCheatLog.update({
                where: { id: log.id },
                data: { retentionUntil: addYears(log.occurredAt, years) },
            }),
        ),
    );

    return logs.length;
}
