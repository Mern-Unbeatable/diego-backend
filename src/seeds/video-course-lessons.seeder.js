import { prisma } from '../config/db.js';
import { Logger } from '../config/logger.js';

const log = new Logger('VideoCourseLessonsSeeder');

const COURSE_ID = 'db3c9a83-2508-44f2-8f41-6a2b4d788ac2';

const VIDEO_LESSONS = [
  {
    title: {
      en: 'Module 1: What is Web Development?',
      it: "Modulo 1: Cos'è lo sviluppo web?",
    },
    orderIndex: 0,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 600,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 2: HTML Fundamentals',
      it: 'Modulo 2: Fondamenti HTML',
    },
    orderIndex: 1,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 900,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 3: CSS Basics & Flexbox',
      it: 'Modulo 3: CSS Base e Flexbox',
    },
    orderIndex: 2,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1200,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 4: JavaScript Variables & Data Types',
      it: 'Modulo 4: Variabili e Tipi di Dati JavaScript',
    },
    orderIndex: 3,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1100,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 5: JavaScript Functions',
      it: 'Modulo 5: Funzioni JavaScript',
    },
    orderIndex: 4,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1000,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 6: DOM Manipulation',
      it: 'Modulo 6: Manipolazione del DOM',
    },
    orderIndex: 5,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1300,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 7: React Introduction',
      it: 'Modulo 7: Introduzione a React',
    },
    orderIndex: 6,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1400,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 8: React Components & Props',
      it: 'Modulo 8: Componenti React e Props',
    },
    orderIndex: 7,
    contentType: 'VIDEO_YOUTUBE',
    youtubeUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1500,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 9: Final Project Walkthrough',
      it: 'Modulo 9: Progetto Finale',
    },
    orderIndex: 8,
    contentType: 'VIDEO_UPLOAD',
    contentUrl: 'https://youtu.be/ADFDxhipgiI?si=_kgUgNdIM2YOJcSr',
    durationSecs: 1800,
    isRequired: true,
    isLocked: false,
  },
  {
    title: {
      en: 'Module 10: Course Cheat Sheet (PDF)',
      it: 'Modulo 10: Scheda Riassuntiva PDF',
    },
    orderIndex: 9,
    contentType: 'PDF',
    contentUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table.pdf',
    durationSecs: 300,
    isRequired: false,
    isLocked: false,
  },
];

export async function seedVideoCourseLessons(courseId = COURSE_ID) {
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

  for (const lesson of VIDEO_LESSONS) {
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
        title: true,
      },
    });

    log.info(
      `Lesson created — orderIndex: ${createdLesson.orderIndex} | type: ${createdLesson.contentType} | id: ${createdLesson.id}`,
    );
    created++;
  }

  log.info(
    `Video course lessons seed completed for course ${courseId} — ${created} created, ${skipped} skipped`,
  );

  return { courseId, created, skipped, total: VIDEO_LESSONS.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVideoCourseLessons()
    .catch((error) => {
      log.error('Video course lessons seed failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
