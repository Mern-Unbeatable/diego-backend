import { prisma } from '../config/db.js';
import { Logger } from '../config/logger.js';
import { seedVideoCourseLessons } from './video-course-lessons.seeder.js';
import { seedVideoCourseQuiz } from './video-course-quiz.seeder.js';
import { seedScormCourseLessons } from './scorm-course-lessons.seeder.js';

const log = new Logger('CourseDemoSeeder');

const DEFAULT_COURSE_ID = 'd2843463-b795-4884-a918-4d2def2e5ca9';

export async function seedCourseDemo(courseId = DEFAULT_COURSE_ID) {
  log.info(`Starting full course demo seed for course ${courseId}`);

  const lessons = await seedVideoCourseLessons(courseId);
  const quizzes = await seedVideoCourseQuiz(courseId);
  const scormLessons = await seedScormCourseLessons(courseId);

  log.info('Full course demo seed completed');

  return {
    courseId,
    lessons,
    quizzes,
    scormLessons,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const courseId = process.argv[2] || DEFAULT_COURSE_ID;

  seedCourseDemo(courseId)
    .catch((error) => {
      log.error('Course demo seed failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
