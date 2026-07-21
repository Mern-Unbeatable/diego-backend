import cron from 'node-cron';
import { prisma } from '../../config/db.js';
import { notificationService } from '../../features/notification/notification.service.js';
import { Logger } from '../../config/logger.js';
import { addDays } from 'date-fns';

const log = new Logger('ExpiryCheckJob');

async function checkEnrollmentExpiry() {
  const now = new Date();

  const expiredEnrollments = await prisma.enrollment.updateMany({
    where: { expiresAt: { lt: now }, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
    data: { status: 'EXPIRED' },
  });
  log.info(`Marked ${expiredEnrollments.count} enrollments as EXPIRED`);

  const soon = addDays(now, 7);
  const expiringSoon = await prisma.enrollment.findMany({
    where: {
      expiresAt: { gte: now, lte: soon },
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      companyCoursePurchaseId: null,
    },
    select: { id: true, userId: true, expiresAt: true, course: { select: { courseTitle: true, tenantId: true } } },
  });

  for (const e of expiringSoon) {
    const alreadyAlerted = await prisma.alert.findFirst({
      where: { userId: e.userId, relatedEnrollmentId: e.id, severity: 'YELLOW', dismissed: false },
    });
    if (alreadyAlerted) continue;

    const user = await prisma.user.findUnique({ where: { id: e.userId }, select: { alertsOptOut: true } });
    if (user?.alertsOptOut) continue;

    await prisma.alert.create({
      data: {
        userId: e.userId, severity: 'YELLOW',
        message: { it: 'Il tuo corso sta per scadere', en: 'Your course is expiring soon' },
        relatedEnrollmentId: e.id, tenantId: e.course.tenantId,
      },
    });

    notificationService.notifyExpiringEnrollment?.({
      userId: e.userId, courseTitle: e.course.courseTitle, expiresAt: e.expiresAt,
    }).catch(() => { });
  }

  // ৩. Company corporate purchase expiry — 
  const expiredCorporatePurchases = await prisma.companyCoursePurchase.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, companyId: true },
  });
  for (const p of expiredCorporatePurchases) {
    await prisma.enrollment.updateMany({
      where: { companyCoursePurchaseId: p.id, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
      data: { status: 'EXPIRED' },
    });
  }
  log.info(`Checked ${expiredCorporatePurchases.length} expired corporate purchases`);

  // ৪. Corporate purchase — notify company admins if a corporate purchase is expiring soon (7 days)
  const expiringSoonCorporate = await prisma.companyCoursePurchase.findMany({
    where: { expiresAt: { gte: now, lte: soon } },
    include: { company: { select: { id: true } }, course: { select: { courseTitle: true, tenantId: true } } },
  });

  for (const p of expiringSoonCorporate) {
    const admins = await prisma.user.findMany({
      where: { companyId: p.companyId, level: 'COMPANY_ADMIN' },
      select: { id: true, email: true, alertsOptOut: true },
    });
    for (const admin of admins) {
      if (admin.alertsOptOut) continue;

      const alreadyAlerted = await prisma.alert.findFirst({
        where: { userId: admin.id, severity: 'YELLOW', dismissed: false, message: { path: ['companyCoursePurchaseId'], equals: p.id } },
      });
      if (alreadyAlerted) continue;

      await prisma.alert.create({
        data: {
          userId: admin.id, severity: 'YELLOW',
          message: { it: 'Un pacchetto aziendale sta per scadere', en: 'A corporate course purchase is expiring soon', companyCoursePurchaseId: p.id },
          tenantId: p.course.tenantId,
        },
      });

      notificationService.notifyExpiringCorporatePurchase?.({
        userId: admin.id, email: admin.email, courseTitle: p.course.courseTitle, expiresAt: p.expiresAt,
      }).catch(() => { });
    }
  }
}

export function startExpiryCheckJob() {
  cron.schedule('0 2 * * *', async () => {
    log.info('Running daily expiry check...');
    try { await checkEnrollmentExpiry(); }
    catch (err) { log.error(`Expiry check failed: ${err.message}`); }
  });
  log.info('Expiry check cron job scheduled (daily at 02:00)');
}