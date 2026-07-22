import { addDays, addYears, differenceInCalendarDays } from 'date-fns';
import { prisma } from '../../config/db.js';
import { platformSettingService } from '../platformSetting/platformSetting.service.js';

export async function getArchivePlan(locale = 'it') {
    return platformSettingService.getCertificateArchivePlan(locale);
}

export async function getArchiveConfig() {
    const settings = await platformSettingService.getSettings();
    return platformSettingService.getCertificateArchiveConfig(settings);
}

export async function computeFreeDownloadUntil(issuedAt = new Date()) {
    const config = await getArchiveConfig();
    return addDays(new Date(issuedAt), config.freeDownloadDays);
}

export async function computeLegalRetentionUntil(issuedAt = new Date()) {
    const config = await getArchiveConfig();
    return addYears(new Date(issuedAt), config.legalRetentionYears);
}

export async function getActiveArchiveSubscription(userId) {
    if (!userId) return null;
    const sub = await prisma.archiveSubscription.findUnique({
        where: { userId },
    });
    if (!sub?.isActive) return null;
    if (sub.expiresAt && sub.expiresAt < new Date()) return null;
    return sub;
}

export async function userHasArchiveAccess(userId) {
    return Boolean(await getActiveArchiveSubscription(userId));
}

/**
 * @returns {'AVAILABLE' | 'EXPIRED_NEED_ARCHIVE' | 'LOCKED'}
 */
export function resolveDownloadStatus(certificate, hasArchiveAccess) {
    if (certificate.status !== 'ISSUED') return 'LOCKED';
    const now = new Date();
    if (certificate.downloadableUntil && now <= certificate.downloadableUntil) {
        return 'AVAILABLE';
    }
    if (hasArchiveAccess) return 'AVAILABLE';
    return 'EXPIRED_NEED_ARCHIVE';
}

export function formatCertificateAccess(certificate, hasArchiveAccess) {
    const now = new Date();
    const downloadStatus = resolveDownloadStatus(certificate, hasArchiveAccess);
    const daysRemaining = certificate.downloadableUntil
        ? Math.max(0, differenceInCalendarDays(certificate.downloadableUntil, now))
        : 0;

    return {
        downloadStatus,
        canDownload: downloadStatus === 'AVAILABLE',
        daysRemaining,
        isFreeWindowActive: Boolean(certificate.downloadableUntil && now <= certificate.downloadableUntil),
        isExpired: downloadStatus === 'EXPIRED_NEED_ARCHIVE',
        freeDownloadMessage:
            downloadStatus === 'AVAILABLE' && daysRemaining > 0
                ? `Disponibile per ${daysRemaining} giorni`
                : downloadStatus === 'EXPIRED_NEED_ARCHIVE'
                    ? 'Acquista il servizio di archiviazione per scaricare di nuovo'
                    : null,
        needsArchivePurchase: downloadStatus === 'EXPIRED_NEED_ARCHIVE',
    };
}

export async function activateArchiveSubscription(userId, paymentId, tenantId = null) {
    const config = await getArchiveConfig();
    const now = new Date();
    const expiresAt = addDays(now, config.durationDays);

    const existing = await prisma.archiveSubscription.findUnique({ where: { userId } });

    const subscription = existing
        ? await prisma.archiveSubscription.update({
            where: { userId },
            data: {
                isActive: true,
                startedAt: now,
                expiresAt,
                storageMb: config.storageMb,
                tenantId: tenantId ?? existing.tenantId,
            },
        })
        : await prisma.archiveSubscription.create({
            data: {
                userId,
                isActive: true,
                startedAt: now,
                expiresAt,
                storageMb: config.storageMb,
                tenantId,
            },
        });

    if (paymentId) {
        await prisma.payment.update({
            where: { id: paymentId },
            data: { archiveSubscriptionId: subscription.id },
        });
    }

    const retentionCutoff = addYears(now, -config.legalRetentionYears);
    await prisma.certificate.updateMany({
        where: {
            userId,
            status: 'ISSUED',
            issuedAt: { gte: retentionCutoff },
        },
        data: {
            archived: false,
            archivedAt: null,
        },
    });

    return subscription;
}

/** Mark certificates past free window as archived (PDF kept on disk for compliance) */
export async function markExpiredFreeDownloadsAsArchived() {
    const now = new Date();
    const result = await prisma.certificate.updateMany({
        where: {
            status: 'ISSUED',
            archived: false,
            downloadableUntil: { lt: now },
            user: {
                archiveSubscription: {
                    OR: [
                        { isActive: false },
                        { expiresAt: { lt: now } },
                    ],
                },
            },
        },
        data: {
            archived: true,
            archivedAt: now,
        },
    });
    return result.count;
}
