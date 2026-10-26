-- Multiple notebooks. Until now every Notebook entry lived in one implicit
-- notebook; each user with entries gets a "My Notebook" that holds all of
-- them. Entries keep their ids, content and timestamps (only notebookId is
-- set). Every step is guarded, so running this again changes nothing and
-- never creates a second default notebook or duplicates an entry.
BEGIN;

CREATE TABLE IF NOT EXISTS "Notebook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notebook_userId_idx" ON "Notebook"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Notebook_userId_name_key" ON "Notebook"("userId", "name");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notebook_userId_fkey') THEN
        ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "NotebookEntry" ADD COLUMN IF NOT EXISTS "notebookId" TEXT;

-- One "My Notebook" per user who has entries but no notebook yet.
INSERT INTO "Notebook" ("id", "userId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, e."userId", 'My Notebook', MIN(e."createdAt"), CURRENT_TIMESTAMP
FROM "NotebookEntry" e
WHERE e."notebookId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Notebook" n WHERE n."userId" = e."userId")
GROUP BY e."userId";

-- Entries not in a notebook go into their owner's first notebook.
UPDATE "NotebookEntry" e
SET "notebookId" = (
    SELECT n."id" FROM "Notebook" n WHERE n."userId" = e."userId" ORDER BY n."createdAt" ASC, n."id" ASC LIMIT 1
)
WHERE e."notebookId" IS NULL;

ALTER TABLE "NotebookEntry" ALTER COLUMN "notebookId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "NotebookEntry_notebookId_idx" ON "NotebookEntry"("notebookId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotebookEntry_notebookId_fkey') THEN
        ALTER TABLE "NotebookEntry" ADD CONSTRAINT "NotebookEntry_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
