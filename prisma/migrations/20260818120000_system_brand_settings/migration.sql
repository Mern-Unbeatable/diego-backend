-- System & brand settings for platform admin
ALTER TABLE "PlatformSetting"
ADD COLUMN IF NOT EXISTS "smtpHost" TEXT,
ADD COLUMN IF NOT EXISTS "smtpPort" INTEGER,
ADD COLUMN IF NOT EXISTS "smtpFromEmail" TEXT,
ADD COLUMN IF NOT EXISTS "platformName" TEXT,
ADD COLUMN IF NOT EXISTS "primaryColor" TEXT,
ADD COLUMN IF NOT EXISTS "platformLogoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "emailTemplates" JSONB;
