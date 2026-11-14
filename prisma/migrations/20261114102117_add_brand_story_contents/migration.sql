-- CreateTable
CREATE TABLE "BrandStoryContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "storyDate" TEXT NOT NULL,
    "comments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "completedByName" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandStoryContent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandStoryContent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BrandStoryContent_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandStoryAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyContentId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandStoryAsset_storyContentId_fkey" FOREIGN KEY ("storyContentId") REFERENCES "BrandStoryContent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandStoryAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandStoryContent_brandId_storyDate_key" ON "BrandStoryContent"("brandId", "storyDate");

-- CreateIndex
CREATE INDEX "BrandStoryAsset_storyContentId_sortOrder_idx" ON "BrandStoryAsset"("storyContentId", "sortOrder");
