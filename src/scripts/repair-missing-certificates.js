import { prisma } from '../config/db.js';
import { certificateService } from '../features/certificate/certificate.service.js';
import { Logger } from '../config/logger.js';

const log = new Logger('RepairMissingCertificates');

async function repairMissingCertificates() {
  const completedWithoutCertificate = await prisma.enrollment.findMany({
    where: {
      status: 'COMPLETED',
      certificate: null,
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      completedAt: true,
      user: { select: { email: true } },
      course: { select: { courseTitle: true } },
    },
  });

  if (completedWithoutCertificate.length === 0) {
    log.info('No completed enrollments without certificates.');
    return { repaired: 0, failed: 0 };
  }

  let repaired = 0;
  let failed = 0;

  for (const enrollment of completedWithoutCertificate) {
    try {
      const certificate = await certificateService.ensureCertificateForEnrollment(enrollment.id);
      repaired++;
      log.info(
        `Certificate generated for enrollment ${enrollment.id} (${enrollment.user.email}) → ${certificate.pdfUrl}`,
      );
    } catch (error) {
      failed++;
      log.error(`Failed for enrollment ${enrollment.id}: ${error.message}`);
    }
  }

  log.info(`Repair finished — ${repaired} generated, ${failed} failed`);
  return { repaired, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  repairMissingCertificates()
    .catch((error) => {
      log.error('Repair script failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

export { repairMissingCertificates };
