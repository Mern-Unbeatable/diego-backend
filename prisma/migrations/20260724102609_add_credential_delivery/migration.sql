-- CreateTable
CREATE TABLE "CredentialDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "enrollmentId" TEXT,
    "assignedById" TEXT,
    "username" TEXT NOT NULL,
    "temporaryPassword" TEXT,
    "courseName" TEXT NOT NULL,
    "sentFromLabel" TEXT NOT NULL,
    "sentFromType" TEXT,
    "viewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialDelivery_enrollmentId_key" ON "CredentialDelivery"("enrollmentId");

-- CreateIndex
CREATE INDEX "CredentialDelivery_userId_createdAt_idx" ON "CredentialDelivery"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CredentialDelivery" ADD CONSTRAINT "CredentialDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialDelivery" ADD CONSTRAINT "CredentialDelivery_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialDelivery" ADD CONSTRAINT "CredentialDelivery_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialDelivery" ADD CONSTRAINT "CredentialDelivery_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
