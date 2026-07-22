import { Application } from './app.js';
import { config } from './config/config.js';
import { connectDatabase } from './config/db.js';
import { seedLicensePlans } from './seeds/license.plan.seeder.js';
import { startExpiryCheckJob } from './shared/jobs/expiry-check.js';

import { seedPackages } from './seeds/package.seeder.js';
import { seedUsers } from './seeds/user.seeder.js';
import { seedCoursePackages } from './seeds/seed-course-packages.js';
import { seedCertificateArchivePlan } from './seeds/certificate-archive-plan.seeder.js';

const startApplication = async () => {
  const application = new Application();

  try {
    await connectDatabase();
    config.logger.info('Database connected');

    await seedUsers();
    config.logger.info('User seed check completed');

    await seedPackages();
    config.logger.info('Package seed check completed');
    await seedLicensePlans();
    config.logger.info('License plan seed check completed');

    await seedCertificateArchivePlan();
    config.logger.info('Certificate archive plan seed check completed');

    application.start();
    startExpiryCheckJob();
    config.logger.info('Application started successfully');
  } catch (error) {
    config.logger.error('Startup failed', error, 'Bootstrap');
    process.exit(1);
  }
};

startApplication().catch((error) => {
  config.logger.error('Unhandled bootstrap error', error, 'Bootstrap');
  process.exit(1);
});