-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL');

-- AlterTable
ALTER TABLE "PlatformSetting"
ADD COLUMN IF NOT EXISTS "stripeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "paypalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN IF NOT EXISTS "defaultTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN IF NOT EXISTS "paypalOrderId" TEXT,
ADD COLUMN IF NOT EXISTS "paypalCaptureId" TEXT,
ADD COLUMN IF NOT EXISTS "courseId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_courseId_fkey'
  ) THEN
    ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
