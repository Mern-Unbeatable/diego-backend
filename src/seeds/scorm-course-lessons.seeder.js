import { prisma } from '../config/db.js';
import { config } from '../config/config.js';
import { Logger } from '../config/logger.js';

const log = new Logger('ScormCourseLessonsSeeder');

const COURSE_ID = '0c227f68-acb2-4b69-ab4c-241a1de6ea5f';

/**
 * SCORM packages must be extracted (not .zip) and served as static folders.
 *
 * Production setup:
 * 1. Upload/extract SCORM packages under `uploads/scorm/<folder>/`
 * 2. Ensure each folder contains the configured `scormEntryPoint` file
 * 3. Optionally override the base URL:
 *    SCORM_SAMPLE_BASE_URL=https://api.yourdomain.com/uploads/scorm
 */
const SCORM_BASE =
  process.env.SCORM_SAMPLE_BASE_URL?.replace(/\/$/, '') ||
  `${config.API_URL.replace(/\/$/, '')}/uploads/scorm`;

const SCORM_ENTRY_POINT = 'shared/launchpage.html';

const SCORM_LESSONS = [
  {
    title: {
      en: 'SCORM Module 1: Workplace Safety Basics',
      it: 'Modulo SCORM 1: Fondamenti di Sicurezza sul Lavoro',
    },
    orderIndex: 10,
    contentType: 'SCORM',
    scormPackageUrl: `${SCORM_BASE}/golf`,
    scormVersion: '1.2',
    scormEntryPoint: SCORM_ENTRY_POINT,
    durationSecs: 900,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'SCORM Module 2: Emergency Procedures',
      it: 'Modulo SCORM 2: Procedure di Emergenza',
    },
    orderIndex: 11,
    contentType: 'SCORM_12',
    scormPackageUrl: `${SCORM_BASE}/emergency`,
    scormVersion: '1.2',
    scormEntryPoint: SCORM_ENTRY_POINT,
    durationSecs: 1200,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'SCORM Module 3: Fire Prevention',
      it: 'Modulo SCORM 3: Prevenzione Incendi',
    },
    orderIndex: 12,
    contentType: 'SCORM',
    scormPackageUrl: `${SCORM_BASE}/fire-prevention`,
    scormVersion: '1.2',
    scormEntryPoint: SCORM_ENTRY_POINT,
    durationSecs: 1000,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'SCORM Module 4: PPE and Risk Assessment',
      it: 'Modulo SCORM 4: DPI e Valutazione dei Rischi',
    },
    orderIndex: 13,
    contentType: 'SCORM',
    scormPackageUrl: `${SCORM_BASE}/ppe-risk`,
    scormVersion: '1.2',
    scormEntryPoint: SCORM_ENTRY_POINT,
    durationSecs: 1100,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'SCORM Module 5: Final Safety Review (SCORM)',
      it: 'Modulo SCORM 5: Ripasso Finale Sicurezza',
    },
    orderIndex: 14,
    contentType: 'SCORM_12',
    scormPackageUrl: `${SCORM_BASE}/safety-review`,
    scormVersion: '1.2',
    scormEntryPoint: SCORM_ENTRY_POINT,
    durationSecs: 800,
    isRequired: true,
    isLocked: false,
  },
];

export async function seedScormCourseLessons(courseId = COURSE_ID) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, courseTitle: true },
  });

  if (!course) {
    throw new Error(`Course not found — id: ${courseId}`);
  }

  const existingLessons = await prisma.lesson.findMany({
    where: { courseId },
    select: { orderIndex: true },
  });

  const existingOrderIndexes = new Set(existingLessons.map((lesson) => lesson.orderIndex));

  let created = 0;
  let skipped = 0;

  for (const lesson of SCORM_LESSONS) {
    if (existingOrderIndexes.has(lesson.orderIndex)) {
      log.info(`Lesson already exists, skipped — orderIndex: ${lesson.orderIndex}`);
      skipped++;
      continue;
    }

    const createdLesson = await prisma.lesson.create({
      data: {
        courseId,
        ...lesson,
      },
      select: {
        id: true,
        orderIndex: true,
        contentType: true,
        scormPackageUrl: true,
        scormEntryPoint: true,
        title: true,
      },
    });

    log.info(
      `SCORM lesson created — orderIndex: ${createdLesson.orderIndex} | type: ${createdLesson.contentType} | id: ${createdLesson.id}`,
    );
    created++;
  }

  log.info(
    `SCORM course lessons seed completed for course ${courseId} — ${created} created, ${skipped} skipped`,
  );
  log.info(`SCORM base URL used: ${SCORM_BASE}`);

  return { courseId, created, skipped, total: SCORM_LESSONS.length, scormBaseUrl: SCORM_BASE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedScormCourseLessons()
    .catch((error) => {
      log.error('SCORM course lessons seed failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
