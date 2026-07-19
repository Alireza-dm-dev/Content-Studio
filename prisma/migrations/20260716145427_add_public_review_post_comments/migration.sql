-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PublishedPostComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedPostId" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceReviewId" TEXT,
    "authorName" TEXT NOT NULL,
    "reviewerName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishedPostComment_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "PublishedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishedPostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PublishedPostComment_workspaceReviewId_fkey" FOREIGN KEY ("workspaceReviewId") REFERENCES "WorkspaceReview" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PublishedPostComment" ("authorName", "body", "createdAt", "id", "publishedPostId", "updatedAt", "userId") SELECT "authorName", "body", "createdAt", "id", "publishedPostId", "updatedAt", "userId" FROM "PublishedPostComment";
DROP TABLE "PublishedPostComment";
ALTER TABLE "new_PublishedPostComment" RENAME TO "PublishedPostComment";
CREATE INDEX "PublishedPostComment_publishedPostId_createdAt_idx" ON "PublishedPostComment"("publishedPostId", "createdAt");
CREATE INDEX "PublishedPostComment_userId_idx" ON "PublishedPostComment"("userId");
CREATE INDEX "PublishedPostComment_workspaceReviewId_idx" ON "PublishedPostComment"("workspaceReviewId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
