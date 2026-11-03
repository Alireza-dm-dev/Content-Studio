-- CreateTable
CREATE TABLE "BrandKnowledgeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "originalFileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "extractedText" TEXT,
    "extractionError" TEXT,
    "wasTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandKnowledgeDocument_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandKnowledgeDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrandKnowledgeDocument_brandId_status_idx" ON "BrandKnowledgeDocument"("brandId", "status");

-- CreateIndex
CREATE INDEX "BrandKnowledgeDocument_uploadedByUserId_idx" ON "BrandKnowledgeDocument"("uploadedByUserId");
