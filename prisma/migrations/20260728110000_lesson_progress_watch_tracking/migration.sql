-- AlterTable
ALTER TABLE "LessonProgress" ADD COLUMN "watchPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LessonProgress" ADD COLUMN "lastPositionSecs" INTEGER NOT NULL DEFAULT 0;
