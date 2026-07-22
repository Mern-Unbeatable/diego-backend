import { prisma } from '../config/db.js';
import { Logger } from '../config/logger.js';
import {
    DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
    DEFAULT_PLATFORM_SETTINGS,
} from '../features/platformSetting/platformSetting.constants.js';

const log = new Logger('CertificateArchivePlanSeeder');

function buildArchivePlanSeedData() {
    return {
        ...DEFAULT_CERTIFICATE_ARCHIVE_PLAN,
        certificateArchivePriceEur:
            Number(process.env.ARCHIVE_STORAGE_PRICE)
            || DEFAULT_CERTIFICATE_ARCHIVE_PLAN.certificateArchivePriceEur,
    };
}

function archivePlanNeedsSeed(settings) {
    if (!settings) return true;

    return (
        settings.certificateArchiveName == null
        || settings.certificateArchiveDescription == null
        || settings.certificateArchivePriceEur == null
    );
}

export async function seedCertificateArchivePlan() {
    const archivePlan = buildArchivePlanSeedData();
    const existing = await prisma.platformSetting.findUnique({
        where: { id: 'global' },
    });

    if (!existing) {
        await prisma.platformSetting.create({
            data: {
                id: 'global',
                ...DEFAULT_PLATFORM_SETTINGS,
                ...archivePlan,
            },
        });

        log.info(
            `Platform settings created with certificate archive plan — €${archivePlan.certificateArchivePriceEur} / ${archivePlan.certificateArchiveDurationDays} days`,
        );
        return { created: true, updated: false, skipped: false };
    }

    if (!archivePlanNeedsSeed(existing)) {
        log.info('Certificate archive plan already exists, skipped');
        return { created: false, updated: false, skipped: true };
    }

    await prisma.platformSetting.update({
        where: { id: 'global' },
        data: archivePlan,
    });

    log.info(
        `Certificate archive plan seeded — €${archivePlan.certificateArchivePriceEur} / ${archivePlan.certificateArchiveDurationDays} days`,
    );
    return { created: false, updated: true, skipped: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    seedCertificateArchivePlan()
        .catch((error) => {
            log.error('Certificate archive plan seed failed', error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
