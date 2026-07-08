-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CombinedVisualDirection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "referenceImageAnalysisId" TEXT,
    "brandIdentityId" TEXT,
    "calendarId" TEXT,
    "calendarPostId" TEXT,
    "carouselSlideNumber" INTEGER,
    "sourceFlow" TEXT,
    "textRequirements" TEXT,
    "attractionNotes" TEXT,
    "rawIdeaOrPostInformation" TEXT,
    "jsonOutput" TEXT,
    "editedJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "finalNanobananaPrompt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombinedVisualDirection_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CombinedVisualDirection_referenceImageAnalysisId_fkey" FOREIGN KEY ("referenceImageAnalysisId") REFERENCES "ReferenceImageAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CombinedVisualDirection_brandIdentityId_fkey" FOREIGN KEY ("brandIdentityId") REFERENCES "BrandIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CombinedVisualDirection_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CombinedVisualDirection" ("attractionNotes", "brandId", "brandIdentityId", "createdAt", "id", "jsonOutput", "referenceImageAnalysisId", "textRequirements", "updatedAt") SELECT "attractionNotes", "brandId", "brandIdentityId", "createdAt", "id", "jsonOutput", "referenceImageAnalysisId", "textRequirements", "updatedAt" FROM "CombinedVisualDirection";
DROP TABLE "CombinedVisualDirection";
ALTER TABLE "new_CombinedVisualDirection" RENAME TO "CombinedVisualDirection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
