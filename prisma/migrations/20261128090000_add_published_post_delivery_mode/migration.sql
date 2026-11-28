-- Additive: per-post delivery mode and production-delivery attempt tracking.
-- Existing rows stay NULL (legacy behaviour). No backfill, no rewrite of
-- existing rows, no destructive change.
ALTER TABLE "PublishedPost" ADD COLUMN "deliveryMode" TEXT;
ALTER TABLE "PublishedPost" ADD COLUMN "productionDeliveryAttemptedAt" DATETIME;

-- Durable duplicate-submission receipts (new table; no existing data touched).
CREATE TABLE "PublishedPostSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postId" TEXT,
    "outcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PublishedPostSubmission_scopeKey_key" ON "PublishedPostSubmission"("scopeKey");
CREATE INDEX "PublishedPostSubmission_createdAt_idx" ON "PublishedPostSubmission"("createdAt");
