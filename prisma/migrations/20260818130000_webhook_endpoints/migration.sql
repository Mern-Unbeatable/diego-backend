-- Outbound webhook endpoint settings (API & Integrations tab)
ALTER TABLE "PlatformSetting"
ADD COLUMN IF NOT EXISTS "webhookEndpoints" JSONB;
