-- Ensure TicketPriority enum exists
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketPriority') THEN
        CREATE TYPE "TicketPriority" AS ENUM ('CRITICAL', 'MEDIUM', 'LOW');
    END IF;
END $migration$;

-- Add columns if they were never migrated
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "ticketNumber" INTEGER;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "priority" "TicketPriority";

-- Create / attach autoincrement sequence for ticketNumber
CREATE SEQUENCE IF NOT EXISTS "SupportTicket_ticketNumber_seq";

ALTER TABLE "SupportTicket"
    ALTER COLUMN "ticketNumber" SET DEFAULT nextval('"SupportTicket_ticketNumber_seq"');

-- Backfill missing ticket numbers for existing rows
WITH ordered AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn
    FROM "SupportTicket"
    WHERE "ticketNumber" IS NULL
),
current_max AS (
    SELECT COALESCE(MAX("ticketNumber"), 0) AS max_num
    FROM "SupportTicket"
)
UPDATE "SupportTicket" AS ticket
SET "ticketNumber" = ordered.rn + current_max.max_num
FROM ordered, current_max
WHERE ticket.id = ordered.id;

-- Keep sequence aligned with the highest ticket number
SELECT setval(
    '"SupportTicket_ticketNumber_seq"',
    GREATEST(COALESCE((SELECT MAX("ticketNumber") FROM "SupportTicket"), 0), 1),
    (SELECT COUNT(*) > 0 FROM "SupportTicket" WHERE "ticketNumber" IS NOT NULL)
);

ALTER TABLE "SupportTicket" ALTER COLUMN "ticketNumber" SET NOT NULL;

UPDATE "SupportTicket"
SET "priority" = 'MEDIUM'
WHERE "priority" IS NULL;

ALTER TABLE "SupportTicket"
    ALTER COLUMN "priority" SET DEFAULT 'MEDIUM',
    ALTER COLUMN "priority" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");
CREATE INDEX IF NOT EXISTS "SupportTicket_ticketNumber_idx" ON "SupportTicket"("ticketNumber");
