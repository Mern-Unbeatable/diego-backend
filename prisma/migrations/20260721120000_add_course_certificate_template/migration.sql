-- AlterTable
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "certificateTemplateUrl" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "certificateTemplateConfig" JSONB;
