/**
 * Repair SCORM lessons that still point to .zip URLs.
 * Usage: node scripts/repair-scorm-lessons.mjs [courseId]
 */
import { prisma } from '../src/config/db.js';
import { ensureScormPackagePrepared, looksLikeScormZipUrl } from '../src/shared/scorm/scormPackage.util.js';

const courseId = process.argv[2] || null;

const where = {
  contentType: { in: ['SCORM', 'SCORM_12'] },
  ...(courseId ? { courseId } : {}),
};

const lessons = await prisma.lesson.findMany({
  where,
  select: {
    id: true,
    courseId: true,
    title: true,
    scormPackageUrl: true,
    scormEntryPoint: true,
    scormVersion: true,
  },
});

console.log(`Found ${lessons.length} SCORM lesson(s) to check...`);

for (const lesson of lessons) {
  const label = lesson.title?.it || lesson.title?.en || lesson.id;
  if (!lesson.scormPackageUrl) {
    console.log(`SKIP ${label}: no scormPackageUrl`);
    continue;
  }

  if (!looksLikeScormZipUrl(lesson.scormPackageUrl)) {
    console.log(`OK   ${label}: already folder URL`);
    continue;
  }

  try {
    const prepared = await ensureScormPackagePrepared(
      lesson.scormPackageUrl,
      lesson.scormEntryPoint,
      lesson.scormVersion ?? '1.2',
    );

    await prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        scormPackageUrl: prepared.scormPackageUrl,
        scormEntryPoint: prepared.scormEntryPoint,
      },
    });

    console.log(`FIXED ${label}`);
    console.log(`  -> ${prepared.scormPackageUrl}`);
    console.log(`  -> entry: ${prepared.scormEntryPoint}`);
  } catch (error) {
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

await prisma.$disconnect();
