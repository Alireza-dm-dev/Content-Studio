/*
  Warnings:

  - You are about to drop the `CalendarEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GeneratedImage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GeneratedVideo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Prompt` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `colors` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `fonts` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `logoPath` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `niche` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `tone` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `ContentCalendar` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `ContentCalendar` table. All the data in the column will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CalendarEntry";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GeneratedImage";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GeneratedVideo";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Prompt";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "BrandIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "jsonOutput" TEXT,
    "editableSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandIdentity_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "calendarPostId" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "purpose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UploadedFile_calendarPostId_fkey" FOREIGN KEY ("calendarPostId") REFERENCES "CalendarPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "postNumber" INTEGER,
    "date" DATETIME,
    "platform" TEXT,
    "format" TEXT,
    "suggestedHook" TEXT,
    "mainAngleAndCoreMessage" TEXT,
    "suggestedCaption" TEXT,
    "contentStructure" TEXT,
    "visualDirection" TEXT,
    "outputImageTextRequirements" TEXT,
    "inspirationSource" TEXT,
    "referenceLink" TEXT,
    "adaptationNote" TEXT,
    "contentOrigin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarPost_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "calendarId" TEXT,
    "calendarPostId" TEXT,
    "type" TEXT,
    "mode" TEXT,
    "targetTool" TEXT,
    "rawInput" TEXT,
    "referenceData" TEXT,
    "finalPrompt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedPrompt_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedPrompt_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedPrompt_calendarPostId_fkey" FOREIGN KEY ("calendarPostId") REFERENCES "CalendarPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "templateText" TEXT NOT NULL,
    "outputType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReferenceImageAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "uploadedFileId" TEXT,
    "jsonOutput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReferenceImageAnalysis_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReferenceImageAnalysis_uploadedFileId_fkey" FOREIGN KEY ("uploadedFileId") REFERENCES "UploadedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CombinedVisualDirection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "referenceImageAnalysisId" TEXT,
    "brandIdentityId" TEXT,
    "textRequirements" TEXT,
    "attractionNotes" TEXT,
    "jsonOutput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombinedVisualDirection_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CombinedVisualDirection_referenceImageAnalysisId_fkey" FOREIGN KEY ("referenceImageAnalysisId") REFERENCES "ReferenceImageAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CombinedVisualDirection_brandIdentityId_fkey" FOREIGN KEY ("brandIdentityId") REFERENCES "BrandIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "instagramPage" TEXT,
    "linkedinPage" TEXT,
    "facebookPage" TEXT,
    "businessLocation" TEXT,
    "businessType" TEXT,
    "mainServicesOrProducts" TEXT,
    "targetAudience" TEXT,
    "brandTone" TEXT,
    "brandVisualStyle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Brand" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Brand";
DROP TABLE "Brand";
ALTER TABLE "new_Brand" RENAME TO "Brand";
CREATE TABLE "new_ContentCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "platform" TEXT,
    "timePeriod" TEXT,
    "mainMonthlySubject" TEXT,
    "mainGoal" TEXT,
    "mainOfferOrMessage" TEXT,
    "sourceMaterial" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentCalendar_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ContentCalendar" ("brandId", "createdAt", "id", "platform", "status", "title", "updatedAt") SELECT "brandId", "createdAt", "id", "platform", "status", "title", "updatedAt" FROM "ContentCalendar";
DROP TABLE "ContentCalendar";
ALTER TABLE "new_ContentCalendar" RENAME TO "ContentCalendar";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_slug_key" ON "PromptTemplate"("slug");
