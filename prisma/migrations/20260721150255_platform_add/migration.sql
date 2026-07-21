-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "downloadPermissionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "newUserRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentProcessingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
