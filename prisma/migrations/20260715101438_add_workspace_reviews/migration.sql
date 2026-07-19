-- CreateTable
CREATE TABLE "WorkspaceReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "createdById" TEXT,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "includeCalendars" BOOLEAN NOT NULL DEFAULT true,
    "includeInstagram" BOOLEAN NOT NULL DEFAULT true,
    "includeLinkedIn" BOOLEAN NOT NULL DEFAULT true,
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceReview_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceReview_tokenHash_key" ON "WorkspaceReview"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceReview_brandId_createdAt_idx" ON "WorkspaceReview"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceReview_createdById_idx" ON "WorkspaceReview"("createdById");
