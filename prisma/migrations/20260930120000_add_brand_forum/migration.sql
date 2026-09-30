-- CreateTable
CREATE TABLE "BrandForumPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'user',
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandForumPost_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandForumAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandForumAttachment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BrandForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandForumReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'user',
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandForumReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BrandForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandForumReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrandForumPost_brandId_createdAt_idx" ON "BrandForumPost"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "BrandForumPost_authorId_idx" ON "BrandForumPost"("authorId");

-- CreateIndex
CREATE INDEX "BrandForumAttachment_postId_idx" ON "BrandForumAttachment"("postId");

-- CreateIndex
CREATE INDEX "BrandForumReply_postId_createdAt_idx" ON "BrandForumReply"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "BrandForumReply_authorId_idx" ON "BrandForumReply"("authorId");

