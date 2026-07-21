import { prisma } from '../config/db.js';
import { config } from '../config/config.js';
import { translateFields } from '../shared/services/translate/translate.service.js';

const PACKAGES_IT = [
  {
    slug: 'pacchetto-base',
    price: 150.0,
    seatsCount: 5,
    validityDays: 180,
    isActive: true,
    name: 'Pacchetto Base',
    description: 'Pacchetto formativo per piccoli team — fino a 5 corsisti su un singolo corso.',
  },
  {
    slug: 'pacchetto-sicurezza-seveso',
    price: 890.0,
    seatsCount: 16,
    validityDays: 180,
    isActive: true,
    name: 'Pacchetto Sicurezza Seveso (A-D)',
    description:
      'Formazione completa Seveso A/B/C/D per fino a 16 corsisti (4 moduli x 4 dipendenti).',
  },
  {
    slug: 'pacchetto-enterprise',
    price: 2400.0,
    seatsCount: 50,
    validityDays: 365,
    isActive: true,
    name: 'Pacchetto Enterprise',
    description: 'Pacchetto aziendale esteso — fino a 50 utenze su più corsi, rinnovabile.',
  },
];

export async function seedPackages() {
  const { logger } = config;

  try {
    let created = 0;
    let skipped = 0;

    for (const pkg of PACKAGES_IT) {
      const existing = await prisma.package.findUnique({
        where: { slug: pkg.slug },
        select: { id: true },
      });

      if (existing) {
        logger.info(`Package already exists, skipped — slug: ${pkg.slug}`);
        skipped++;
        continue;
      }

      const i18n = await translateFields({ name: pkg.name, description: pkg.description });

      const createdPkg = await prisma.package.create({
        data: {
          slug: pkg.slug,
          price: pkg.price,
          seatsCount: pkg.seatsCount,
          validityDays: pkg.validityDays,
          isActive: pkg.isActive,
          name: i18n.name,
          description: i18n.description,
          tenantId: null,
        },
        select: {
          id: true,
          slug: true,
          price: true,
          seatsCount: true,
          validityDays: true,
          name: true,
          tenantId: true,
        },
      });

      logger.info(
        `Package created — slug: ${createdPkg.slug} | € ${createdPkg.price} | ${createdPkg.seatsCount} seats | tenantId: ${createdPkg.tenantId ?? 'platform-level'} | name: ${JSON.stringify(createdPkg.name)}`,
      );
      created++;
    }

    logger.info(`Package seed completed — ${created} created, ${skipped} already existed`);
  } catch (error) {
    logger.error('Package seed failed', error, 'PackageSeeder');
    throw error;
  }
}