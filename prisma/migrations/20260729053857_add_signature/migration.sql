-- AlterTable
ALTER TABLE "AntiCheatLog" ADD COLUMN     "retentionUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "participantSignatureUrl" TEXT,
ADD COLUMN     "signatureUploadedAt" TIMESTAMP(3),
ADD COLUMN     "trainingReportConfirmedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AntiCheatLog_occurredAt_idx" ON "AntiCheatLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AntiCheatLog_retentionUntil_idx" ON "AntiCheatLog"("retentionUntil");
