
import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { config } from '../config/config.js';

const DEFAULT_PASSWORD = 'Password@123';

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}


async function ensureCompany() {
  const vatNumber = 'IT09876543210';
  const existing = await prisma.company.findUnique({ where: { vatNumber } });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      name: 'Acme Formazione S.r.l.',
      fiscalAddress: 'Via Roma 1, 00100 Roma (RM)',
      vatNumber,
      fiscalCode: 'ACMFRM80A01H501X',
      pec: 'acme.formazione@pec.it',
      uniqueCode: 'ABC1234',
    },
  });
}

async function ensureSecondCompany() {
  const vatNumber = 'IT12345678901';
  const existing = await prisma.company.findUnique({ where: { vatNumber } });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      name: 'Tech Solutions S.r.l.',
      fiscalAddress: 'Via Milano 5, 20100 Milano (MI)',
      vatNumber,
      fiscalCode: 'TCHSLT80A01H501X',
      pec: 'tech.solutions@pec.it',
      uniqueCode: 'TECH123',
    },
  });
}

// ─────────────────────────────────────────────
// TENANT HELPERS
// ─────────────────────────────────────────────

async function ensureTenant({ name, subdomain, customDomain, ownerId }) {
  const existing = await prisma.tenant.findFirst({
    where: {
      OR: [
        { subdomain },
        ...(customDomain ? [{ customDomain }] : []),
      ],
    },
  });
  if (existing) return existing;
  return prisma.tenant.create({
    data: { name, subdomain, customDomain: customDomain ?? null, primaryColor: '#0F62FE', isActive: true, ownerId },
  });
}

async function ensurePlatformTenant() {
  const customDomain = 'diego.maktechgroup.tech';
  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ customDomain }, { subdomain: 'platform' }] },
  });

  if (existing) {
    if (existing.customDomain !== customDomain) {
      return prisma.tenant.update({
        where: { id: existing.id },
        data: { customDomain, subdomain: null, name: 'Maktech Platform' },
      });
    }
    return existing;
  }

  return prisma.tenant.create({
    data: {
      name: 'Maktech Platform',
      subdomain: null,
      customDomain,
      primaryColor: '#1A73E8',
      isActive: true,
      ownerId: null,
    },
  });
}


async function ensureLicense({ userId, tenantId, companyName, subdomain, customDomain, planTier }) {
  const existing = await prisma.license.findUnique({ where: { userId } });
  if (existing) return existing;

  // Resolve plan
  const plan = await prisma.licensePlan.findUnique({ where: { tier: planTier } });
  if (!plan) throw new Error(`LicensePlan "${planTier}" not found. Run seedLicensePlans() first.`);

  return prisma.license.create({
    data: {
      userId,
      tenantId,
      planId: plan.id,
      companyName: `${companyName} Academy`,
      subdomain,
      customDomain: customDomain ?? null,
      maxUsers: plan.maxUsers,
      maxCourses: plan.maxCourses,
      storageMb: plan.storageMb,
      priceAtPurchase: plan.priceMonthly,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      autoRenew: false,
      isSuspended: false,
    },
  });
}

// ─────────────────────────────────────────────
// EMPLOYEE HELPER
// ─────────────────────────────────────────────

async function createEmployeeRecord(userId, companyId, jobTitle) {
  const existing = await prisma.employee.findUnique({ where: { userId } });
  if (existing) return false;
  await prisma.employee.create({ data: { userId, companyId, jobTitle } });
  return true;
}

// ─────────────────────────────────────────────
// USER DEFINITIONS
// ─────────────────────────────────────────────

function buildUsers({ companyId }) {
  return [
    // 1. PRIVATE USER
    {
      email: 'sikder@gmail.com',
      level: 'PRIVATE_USER',
      status: 'ACTIVE',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      preferredLanguage: 'it',
      firstName: 'Mario',
      lastName: 'Rossi',
      birthDate: new Date('1990-05-12'),
      city: 'Roma',
      country: 'Italy',
      traineeTaxCode: 'RSSMRA90E12H501Z',
      residenceAddress: 'Via Garibaldi 10, 00100 Roma (RM)',
      profileCompleted: true,
      consentGiven: true,
      consentDate: new Date(),
      citizenship: 'ITALIAN',
      alertsOptOut: false,
      companyId: null,
      tenantId: null,
      // meta (not written to DB)
      _employee: null,
      _tenant: null,
      _license: null,
    },

    // 2. COMPANY EMPLOYEE
    {
      email: 'ibrahim.sikder33@gmail.com',
      level: 'COMPANY_EMPLOYEE',
      status: 'ACTIVE',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      preferredLanguage: 'en',
      firstName: 'Franco',
      lastName: 'Verdi',
      birthDate: new Date('1988-03-22'),
      city: 'Milano',
      country: 'Italy',
      traineeTaxCode: 'VRDFNC88C22F205W',
      residenceAddress: 'Via Torino 5, 20100 Milano (MI)',
      profileCompleted: true,
      consentGiven: true,
      consentDate: new Date(),
      citizenship: 'ITALIAN',
      alertsOptOut: false,
      companyId,
      tenantId: null,
      _employee: { jobTitle: 'Senior Software Developer', companyId },
      _tenant: null,
      _license: null,
    },

    // 3. LICENSE_USER
    {
      email: 'ibrahimfr4450@gmail.com',
      level: 'LICENSE_USER',
      status: 'ACTIVE',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      preferredLanguage: 'fr',
      firstName: 'Luca',
      lastName: 'Ferrari',
      birthDate: new Date('1985-07-15'),
      city: 'Napoli',
      country: 'Italy',
      traineeTaxCode: 'FRRLCU85L15F839Z',
      residenceAddress: 'Via Vesuvio 20, 80100 Napoli (NA)',
      profileCompleted: true,
      consentGiven: true,
      consentDate: new Date(),
      citizenship: 'ITALIAN',
      alertsOptOut: false,
      companyId: null,
      tenantId: null,
      _employee: null,
      _tenant: { name: 'Acme Formazione Academy', subdomain: 'acme', customDomain: 'acme.maktechgroup.tech' },
      _license: { companyName: 'Acme Formazione', planTier: 'STANDARD' },
    },

    // 4. LICENSEE — Tech Solutions
    {
      email: 'tech.licensee@techsolutions.com',
      level: 'LICENSE_USER',
      status: 'ACTIVE',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      preferredLanguage: 'en',
      firstName: 'Marco',
      lastName: 'Bianchi',
      birthDate: new Date('1982-09-10'),
      city: 'Milano',
      country: 'Italy',
      traineeTaxCode: 'BNCMRC82P10F205X',
      residenceAddress: 'Via Tecnologia 10, 20100 Milano (MI)',
      profileCompleted: true,
      consentGiven: true,
      consentDate: new Date(),
      citizenship: 'ITALIAN',
      alertsOptOut: false,
      companyId: null,
      tenantId: null,
      _employee: null,
      _tenant: { name: 'Tech Solutions Academy', subdomain: 'tech', customDomain: 'tech.maktechgroup.tech' },
      _license: { companyName: 'Tech Solutions', planTier: 'PREMIUM' },
    },

    // 5. PLATFORM ADMIN
    {
      email: 'ibrahimsikder5033@gmail.com',
      level: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      preferredLanguage: 'it',
      firstName: 'Platform',
      lastName: 'Admin',
      birthDate: new Date('1980-01-01'),
      city: 'Roma',
      country: 'Italy',
      traineeTaxCode: 'MSTADM80A01H501Z',
      residenceAddress: 'Via Governo 1, 00100 Roma (RM)',
      profileCompleted: true,
      consentGiven: true,
      consentDate: new Date(),
      citizenship: 'ITALIAN',
      alertsOptOut: false,
      companyId: null,
      tenantId: null,
      _employee: null,
      _tenant: null,   // linked to platformTenant after creation
      _license: null,
    },
  ];
}

// ─────────────────────────────────────────────
// MAIN SEED FUNCTION
// ─────────────────────────────────────────────

export async function seedUsers() {
  // FIX: use config.logger, not destructured — avoids undefined logger bug
  const logger = config.logger;

  try {
    let created = 0;
    let skipped = 0;
    let employeesCreated = 0;
    let tenantsCreated = 0;
    let licensesCreated = 0;

    // ── Companies ──────────────────────────────
    const company = await ensureCompany();
    const secondCompany = await ensureSecondCompany();
    logger.info(`Companies ensured: ${company.name}, ${secondCompany.name}`);

    // ── Platform tenant ────────────────────────
    const platformTenant = await ensurePlatformTenant();
    logger.info(`Platform tenant ensured: ${platformTenant.customDomain}`);

    const hashedPassword = await hashPassword(DEFAULT_PASSWORD);
    const users = buildUsers({ companyId: company.id });

    for (const userData of users) {
      // Strip meta keys before writing to DB
      const { _employee, _tenant, _license, ...dbData } = userData;

      const existing = await prisma.user.findUnique({
        where: { email: dbData.email },
        select: { id: true, level: true, tenantId: true },
      });

      if (existing) {
        logger.info(`User already exists, skipped — ${dbData.email}`);
        skipped++;

        // Keep platform admin linked to correct tenant
        if (dbData.level === 'PLATFORM_ADMIN' && existing.tenantId !== platformTenant.id) {
          await prisma.user.update({ where: { id: existing.id }, data: { tenantId: platformTenant.id } });
          logger.info(`  → Updated platform admin tenant`);
        }
        continue;
      }

      // Create user
      const newUser = await prisma.user.create({
        data: { ...dbData, password: hashedPassword },
        select: { id: true, email: true, level: true, firstName: true, lastName: true },
      });
      logger.info(`User created — ${newUser.email} | ${newUser.level}`);
      created++;

      // ── Employee record ────────────────────
      if (newUser.level === 'COMPANY_EMPLOYEE' && _employee) {
        const ok = await createEmployeeRecord(newUser.id, _employee.companyId, _employee.jobTitle);
        if (ok) { employeesCreated++; logger.info(`  → Employee record: ${_employee.jobTitle}`); }
      }

      // ── Tenant + License (LICENSEE) ────────
      if (newUser.level === 'LICENSE_USER' && _tenant && _license) {
        try {
          const tenant = await ensureTenant({ ..._tenant, ownerId: newUser.id });
          tenantsCreated++;

          await prisma.user.update({ where: { id: newUser.id }, data: { tenantId: tenant.id } });

          const license = await ensureLicense({
            userId: newUser.id,
            tenantId: tenant.id,
            companyName: _license.companyName,
            subdomain: tenant.subdomain,
            customDomain: tenant.customDomain,
            planTier: _license.planTier,
          });
          licensesCreated++;

          logger.info(`  → Tenant: ${tenant.subdomain} | License plan: ${_license.planTier} | expires: ${license.expiresAt.toISOString().split('T')[0]}`);
        } catch (err) {
          logger.error(`  ❌ Tenant/License creation failed for ${newUser.email}: ${err.message}`);
        }
      }

      // ── Platform admin → platform tenant ───
      if (newUser.level === 'PLATFORM_ADMIN') {
        await prisma.user.update({ where: { id: newUser.id }, data: { tenantId: platformTenant.id } });
        logger.info(`  → Linked to platform tenant: ${platformTenant.customDomain}`);
      }
    }

    logger.info('\n========== SEED SUMMARY ==========');
    logger.info(`Users created   : ${created}`);
    logger.info(`Users skipped   : ${skipped}`);
    logger.info(`Employee records: ${employeesCreated}`);
    logger.info(`Tenants created : ${tenantsCreated}`);
    logger.info(`Licenses created: ${licensesCreated}`);
    logger.info(`Default password: ${DEFAULT_PASSWORD}`);
    logger.info('====================================\n');

  } catch (error) {
    // config.logger — safe even if logger is a direct property
    (config.logger ?? console).error('User seed failed', error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// STANDALONE RUN
// ─────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  seedUsers()
    .catch(err => { console.error('Seeding failed:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}