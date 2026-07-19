-- CreateTable
CREATE TABLE "PublishedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "postType" TEXT NOT NULL,
    "caption" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'Instagram',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledDate" DATETIME,
    "notes" TEXT,
    "thumbnailUrl" TEXT,
    "jsonPayload" TEXT,
    "postNumber" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishedPost_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishedPostMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedPostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fileType" TEXT,
    "fileName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedPostMedia_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "PublishedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
