-- CreateTable
CREATE TABLE "PublishedPostCollaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedPostId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedPostCollaborator_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "PublishedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishedPostCollaborator_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PublishedPostCollaborator_brandId_idx" ON "PublishedPostCollaborator"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPostCollaborator_publishedPostId_brandId_key" ON "PublishedPostCollaborator"("publishedPostId", "brandId");
