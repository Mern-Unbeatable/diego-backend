import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { prisma } from '../config/db.js';
import { config } from '../config/config.js';
import { Logger } from '../config/logger.js';

const log = new Logger('ScormSetup');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COURSE_ID = process.env.COURSE_ID || '0c227f68-acb2-4b69-ab4c-241a1de6ea5f';
const ZIP_CANDIDATES = [
  path.join(process.cwd(), 'seeds', 'assets', 'sample-scorm.zip'),
  path.join(__dirname, 'assets', 'sample-scorm.zip'),
];

const ZIP_PATH = ZIP_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const SCORM_ROOT = path.join(process.cwd(), 'uploads', 'scorm');
const GOLF_ENTRY = 'shared/launchpage.html';

const DEMO_FOLDERS = ['golf', 'emergency', 'fire-prevention', 'ppe-risk', 'safety-review'];

const SCORM_BASE =
  process.env.SCORM_SAMPLE_BASE_URL?.replace(/\/$/, '') ||
  `${config.API_URL.replace(/\/$/, '')}/uploads/scorm`;

function extractSampleZip() {
  if (!ZIP_PATH) {
    throw new Error(
      `Missing sample-scorm.zip. Place it in lms/seeds/assets/ or lms/src/seeds/assets/`,
    );
  }

  const golfDir = path.join(SCORM_ROOT, 'golf');
  fs.mkdirSync(golfDir, { recursive: true });

  execSync(`unzip -o "${ZIP_PATH}" -d "${golfDir}"`, { stdio: 'inherit' });

  const entryFile = path.join(golfDir, GOLF_ENTRY);
  if (!fs.existsSync(entryFile)) {
    throw new Error(`Extracted package is missing ${GOLF_ENTRY}`);
  }

  const bundledLmsLaunch = [
    path.join(__dirname, 'assets', 'lms-launchpage.html'),
    path.join(process.cwd(), 'seeds', 'assets', 'lms-launchpage.html'),
  ].find((candidate) => fs.existsSync(candidate));
  const lmsLaunchTarget = path.join(golfDir, 'shared', 'lms-launchpage.html');
  if (bundledLmsLaunch) {
    fs.copyFileSync(bundledLmsLaunch, lmsLaunchTarget);
    log.info('Installed shared/lms-launchpage.html into golf package');
  }

  const srcUploadRoot = path.join(process.cwd(), 'src', 'uploads', 'scorm');

  for (const folder of DEMO_FOLDERS) {
    if (folder === 'golf') continue;
    const target = path.join(SCORM_ROOT, folder);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(golfDir, target, { recursive: true });
    log.info(`Copied golf package → uploads/scorm/${folder}`);
  }

  // Keep legacy path in sync if files were manually placed under src/uploads.
  fs.mkdirSync(srcUploadRoot, { recursive: true });
  for (const folder of DEMO_FOLDERS) {
    const from = path.join(SCORM_ROOT, folder);
    const to = path.join(srcUploadRoot, folder);
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }
  log.info('Synced SCORM packages → src/uploads/scorm/');

  const lmsLaunchSource = path.join(golfDir, 'shared', 'lms-launchpage.html');
  if (fs.existsSync(lmsLaunchSource)) {
    for (const folder of DEMO_FOLDERS) {
      const target = path.join(SCORM_ROOT, folder, 'shared', 'lms-launchpage.html');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(lmsLaunchSource, target);
      const srcTarget = path.join(srcUploadRoot, folder, 'shared', 'lms-launchpage.html');
      fs.mkdirSync(path.dirname(srcTarget), { recursive: true });
      fs.copyFileSync(lmsLaunchSource, srcTarget);
    }
    log.info('Synced shared/lms-launchpage.html to all SCORM demo folders');
  }
}

async function fixScormLessonsInDb(courseId) {
  const lessons = await prisma.lesson.findMany({
    where: {
      courseId,
      contentType: { in: ['SCORM', 'SCORM_12'] },
    },
    orderBy: { orderIndex: 'asc' },
  });

  if (lessons.length === 0) {
    log.warn(`No SCORM lessons found for course ${courseId}`);
    return { updated: 0 };
  }

  const folderByOrder = {
    10: 'golf',
    11: 'emergency',
    12: 'fire-prevention',
    13: 'ppe-risk',
    14: 'safety-review',
  };

  let updated = 0;

  for (const lesson of lessons) {
    const folder = folderByOrder[lesson.orderIndex] || 'golf';
    const scormPackageUrl = `${SCORM_BASE}/${folder}`;

    await prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        scormPackageUrl,
        scormEntryPoint: GOLF_ENTRY,
        scormVersion: '1.2',
      },
    });

    log.info(
      `Updated lesson orderIndex=${lesson.orderIndex} → ${scormPackageUrl}/${GOLF_ENTRY}`,
    );
    updated++;
  }

  return { updated };
}

export async function setupScormDemo(courseId = DEFAULT_COURSE_ID) {
  log.info(`SCORM demo setup for course ${courseId}`);
  log.info(`SCORM base URL: ${SCORM_BASE}`);

  extractSampleZip();
  const { updated } = await fixScormLessonsInDb(courseId);

  log.info('SCORM setup completed');
  log.info(`Test URL: ${SCORM_BASE}/fire-prevention/${GOLF_ENTRY}`);

  return { courseId, scormBaseUrl: SCORM_BASE, lessonsUpdated: updated };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const courseId = process.argv[2] || DEFAULT_COURSE_ID;

  setupScormDemo(courseId)
    .catch((error) => {
      log.error('SCORM setup failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
