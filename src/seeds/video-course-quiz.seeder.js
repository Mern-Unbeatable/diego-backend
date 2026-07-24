import { prisma } from '../config/db.js';
import { Logger } from '../config/logger.js';

const log = new Logger('VideoCourseQuizSeeder');

const COURSE_ID = 'd2843463-b795-4884-a918-4d2def2e5ca9';

const COURSE_QUIZZES = [
  {
    quizTitle: {
      en: 'Pre-Test: Web Development Basics',
      it: 'Pre-Test: Fondamenti di Sviluppo Web',
    },
    quizType: 'PRE_TEST',
    passScorePercent: 60,
    maxAttempts: 2,
    isActive: true,
    isPublished: true,
    questions: [
      {
        id: 'pre-q1',
        text: {
          en: 'What does WWW stand for?',
          it: 'Cosa significa WWW?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'pre-q1-a', text: { en: 'World Wide Web', it: 'World Wide Web' }, isCorrect: true },
          { id: 'pre-q1-b', text: { en: 'World Web Wide', it: 'World Web Wide' }, isCorrect: false },
          { id: 'pre-q1-c', text: { en: 'Wide World Web', it: 'Wide World Web' }, isCorrect: false },
        ],
      },
      {
        id: 'pre-q2',
        text: {
          en: 'Which language is used to style web pages?',
          it: 'Quale linguaggio si usa per stilizzare le pagine web?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'pre-q2-a', text: { en: 'CSS', it: 'CSS' }, isCorrect: true },
          { id: 'pre-q2-b', text: { en: 'HTML', it: 'HTML' }, isCorrect: false },
          { id: 'pre-q2-c', text: { en: 'Python', it: 'Python' }, isCorrect: false },
        ],
      },
      {
        id: 'pre-q3',
        text: {
          en: 'JavaScript runs mainly in the browser.',
          it: 'JavaScript viene eseguito principalmente nel browser.',
        },
        type: 'TRUE_FALSE',
        points: 10,
        options: [
          { id: 'pre-q3-a', text: { en: 'True', it: 'Vero' }, isCorrect: true },
          { id: 'pre-q3-b', text: { en: 'False', it: 'Falso' }, isCorrect: false },
        ],
      },
    ],
  },
  {
    quizTitle: {
      en: 'Post-Test: Web Development Review',
      it: 'Post-Test: Ripasso Sviluppo Web',
    },
    quizType: 'POST_TEST',
    passScorePercent: 70,
    maxAttempts: 3,
    isActive: true,
    isPublished: true,
    questions: [
      {
        id: 'post-q1',
        text: {
          en: 'Which HTML tag creates a hyperlink?',
          it: 'Quale tag HTML crea un collegamento ipertestuale?',
        },
        type: 'SINGLE',
        points: 15,
        options: [
          { id: 'post-q1-a', text: { en: '<a>', it: '<a>' }, isCorrect: true },
          { id: 'post-q1-b', text: { en: '<link>', it: '<link>' }, isCorrect: false },
          { id: 'post-q1-c', text: { en: '<href>', it: '<href>' }, isCorrect: false },
        ],
      },
      {
        id: 'post-q2',
        text: {
          en: 'Which CSS property controls text color?',
          it: 'Quale proprietà CSS controlla il colore del testo?',
        },
        type: 'SINGLE',
        points: 15,
        options: [
          { id: 'post-q2-a', text: { en: 'color', it: 'color' }, isCorrect: true },
          { id: 'post-q2-b', text: { en: 'background', it: 'background' }, isCorrect: false },
          { id: 'post-q2-c', text: { en: 'font-size', it: 'font-size' }, isCorrect: false },
        ],
      },
      {
        id: 'post-q3',
        text: {
          en: 'React is a JavaScript library for building user interfaces.',
          it: 'React è una libreria JavaScript per costruire interfacce utente.',
        },
        type: 'TRUE_FALSE',
        points: 15,
        options: [
          { id: 'post-q3-a', text: { en: 'True', it: 'Vero' }, isCorrect: true },
          { id: 'post-q3-b', text: { en: 'False', it: 'Falso' }, isCorrect: false },
        ],
      },
    ],
  },
  {
    quizTitle: {
      en: 'Final Web Development Assessment',
      it: 'Valutazione Finale Web Development',
    },
    quizType: 'FINAL_TEST',
    passScorePercent: 70,
    maxAttempts: 3,
    isActive: true,
    isPublished: true,
    questions: [
      {
        id: 'q1',
        text: {
          en: 'What does HTML stand for?',
          it: 'Cosa significa HTML?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q1-a', text: { en: 'Hyper Text Markup Language', it: 'Hyper Text Markup Language' }, isCorrect: true },
          { id: 'q1-b', text: { en: 'High Tech Modern Language', it: 'High Tech Modern Language' }, isCorrect: false },
          { id: 'q1-c', text: { en: 'Home Tool Markup Language', it: 'Home Tool Markup Language' }, isCorrect: false },
        ],
      },
      {
        id: 'q2',
        text: {
          en: 'Which tag is used for the largest heading?',
          it: 'Quale tag per il titolo più grande?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q2-a', text: { en: '<h1>', it: '<h1>' }, isCorrect: true },
          { id: 'q2-b', text: { en: '<head>', it: '<head>' }, isCorrect: false },
          { id: 'q2-c', text: { en: '<header>', it: '<header>' }, isCorrect: false },
        ],
      },
      {
        id: 'q3',
        text: {
          en: 'Which hook is used for state in React?',
          it: 'Quale hook per lo stato in React?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q3-a', text: { en: 'useState', it: 'useState' }, isCorrect: true },
          { id: 'q3-b', text: { en: 'useEffect', it: 'useEffect' }, isCorrect: false },
          { id: 'q3-c', text: { en: 'useContext', it: 'useContext' }, isCorrect: false },
        ],
      },
      {
        id: 'q4',
        text: {
          en: 'CSS Flexbox is mainly used for?',
          it: 'CSS Flexbox si usa per?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q4-a', text: { en: 'Layout', it: 'Layout' }, isCorrect: true },
          { id: 'q4-b', text: { en: 'Database', it: 'Database' }, isCorrect: false },
          { id: 'q4-c', text: { en: 'Authentication', it: 'Authentication' }, isCorrect: false },
        ],
      },
      {
        id: 'q5',
        text: {
          en: 'JavaScript is primarily a?',
          it: 'JavaScript è principalmente un?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q5-a', text: { en: 'Programming language', it: 'Linguaggio di programmazione' }, isCorrect: true },
          { id: 'q5-b', text: { en: 'Markup language', it: 'Linguaggio di markup' }, isCorrect: false },
          { id: 'q5-c', text: { en: 'Database', it: 'Database' }, isCorrect: false },
        ],
      },
      {
        id: 'q6',
        text: {
          en: 'Which property makes an element a flex container?',
          it: 'Quale proprietà rende un elemento un contenitore flex?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q6-a', text: { en: 'display: flex', it: 'display: flex' }, isCorrect: true },
          { id: 'q6-b', text: { en: 'position: flex', it: 'position: flex' }, isCorrect: false },
          { id: 'q6-c', text: { en: 'float: flex', it: 'float: flex' }, isCorrect: false },
        ],
      },
      {
        id: 'q7',
        text: {
          en: 'What does DOM stand for?',
          it: 'Cosa significa DOM?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q7-a', text: { en: 'Document Object Model', it: 'Document Object Model' }, isCorrect: true },
          { id: 'q7-b', text: { en: 'Data Object Model', it: 'Data Object Model' }, isCorrect: false },
          { id: 'q7-c', text: { en: 'Digital Output Method', it: 'Digital Output Method' }, isCorrect: false },
        ],
      },
      {
        id: 'q8',
        text: {
          en: 'Which HTTP method is typically used to fetch data?',
          it: 'Quale metodo HTTP si usa per recuperare dati?',
        },
        type: 'SINGLE',
        points: 10,
        options: [
          { id: 'q8-a', text: { en: 'GET', it: 'GET' }, isCorrect: true },
          { id: 'q8-b', text: { en: 'POST', it: 'POST' }, isCorrect: false },
          { id: 'q8-c', text: { en: 'DELETE', it: 'DELETE' }, isCorrect: false },
        ],
      },
      {
        id: 'q9',
        text: {
          en: 'Git is used for version control.',
          it: 'Git si usa per il controllo di versione.',
        },
        type: 'TRUE_FALSE',
        points: 10,
        options: [
          { id: 'q9-a', text: { en: 'True', it: 'Vero' }, isCorrect: true },
          { id: 'q9-b', text: { en: 'False', it: 'Falso' }, isCorrect: false },
        ],
      },
      {
        id: 'q10',
        text: {
          en: 'Responsive design adapts to different screen sizes.',
          it: 'Il design responsive si adatta a diverse dimensioni dello schermo.',
        },
        type: 'TRUE_FALSE',
        points: 10,
        options: [
          { id: 'q10-a', text: { en: 'True', it: 'Vero' }, isCorrect: true },
          { id: 'q10-b', text: { en: 'False', it: 'Falso' }, isCorrect: false },
        ],
      },
    ],
  },
];

export async function seedVideoCourseQuiz(courseId = COURSE_ID) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, tenantId: true, courseTitle: true },
  });

  if (!course) {
    throw new Error(`Course not found — id: ${courseId}`);
  }

  const existingQuizzes = await prisma.quiz.findMany({
    where: { courseId },
    select: { id: true, quizType: true },
  });

  const existingByType = new Map(existingQuizzes.map((quiz) => [quiz.quizType, quiz.id]));
  const forceUpdate = process.env.FORCE_SEED === 'true';

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const quiz of COURSE_QUIZZES) {
    if (existingByType.has(quiz.quizType)) {
      if (forceUpdate && quiz.quizType === 'FINAL_TEST') {
        const quizId = existingByType.get(quiz.quizType);
        await prisma.quiz.update({
          where: { id: quizId },
          data: {
            quizTitle: quiz.quizTitle,
            passScorePercent: quiz.passScorePercent,
            maxAttempts: quiz.maxAttempts,
            isActive: quiz.isActive,
            isPublished: quiz.isPublished,
            questions: quiz.questions,
          },
        });
        log.info(`Quiz updated (FORCE_SEED) — type: ${quiz.quizType} | id: ${quizId}`);
        updated++;
        continue;
      }

      log.info(`Quiz already exists, skipped — type: ${quiz.quizType}`);
      skipped++;
      continue;
    }

    const createdQuiz = await prisma.quiz.create({
      data: {
        courseId,
        quizTitle: quiz.quizTitle,
        quizType: quiz.quizType,
        passScorePercent: quiz.passScorePercent,
        minimumScorePercent: 0,
        failScorePercent: 0,
        isActive: quiz.isActive,
        isPublished: quiz.isPublished,
        maxAttempts: quiz.maxAttempts,
        questions: quiz.questions,
        ...(course.tenantId && { tenantId: course.tenantId }),
      },
      select: {
        id: true,
        quizType: true,
        isPublished: true,
      },
    });

    log.info(
      `Quiz created — type: ${createdQuiz.quizType} | published: ${createdQuiz.isPublished} | id: ${createdQuiz.id}`,
    );
    created++;
  }

  log.info(
    `Video course quiz seed completed for course ${courseId} — ${created} created, ${updated} updated, ${skipped} skipped`,
  );

  return { courseId, created, updated, skipped, total: COURSE_QUIZZES.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVideoCourseQuiz()
    .catch((error) => {
      log.error('Video course quiz seed failed', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
