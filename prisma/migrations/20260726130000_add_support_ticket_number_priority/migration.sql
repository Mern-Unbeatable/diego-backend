-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('CRITICAL', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN "ticketNumber" SERIAL NOT NULL;
ALTER TABLE "SupportTicket" ADD COLUMN "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM';

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");
CREATE INDEX "SupportTicket_ticketNumber_idx" ON "SupportTicket"("ticketNumber");
