-- CreateTable
CREATE TABLE "PublishedPostComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedPostId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishedPostComment_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "PublishedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishedPostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PublishedPostComment_publishedPostId_createdAt_idx" ON "PublishedPostComment"("publishedPostId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishedPostComment_userId_idx" ON "PublishedPostComment"("userId");
