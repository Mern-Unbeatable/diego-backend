-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "certificateArchiveEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "certificateArchiveName" JSONB,
ADD COLUMN     "certificateArchiveDescription" JSONB,
ADD COLUMN     "certificateArchivePriceEur" DECIMAL(10,2) NOT NULL DEFAULT 29.99,
ADD COLUMN     "certificateArchiveCurrency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "certificateArchiveDurationDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "certificateArchiveStorageMb" INTEGER NOT NULL DEFAULT 1024,
ADD COLUMN     "certificateFreeDownloadDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "certificateLegalRetentionYears" INTEGER NOT NULL DEFAULT 5;
