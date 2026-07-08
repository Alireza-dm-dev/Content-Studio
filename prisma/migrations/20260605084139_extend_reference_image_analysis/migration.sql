-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReferenceImageAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "calendarId" TEXT,
    "calendarPostId" TEXT,
    "uploadedFileId" TEXT,
    "sourceFlow" TEXT,
    "jsonOutput" TEXT,
    "editedJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReferenceImageAnalysis_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReferenceImageAnalysis_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReferenceImageAnalysis_uploadedFileId_fkey" FOREIGN KEY ("uploadedFileId") REFERENCES "UploadedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReferenceImageAnalysis" ("brandId", "createdAt", "id", "jsonOutput", "updatedAt", "uploadedFileId") SELECT "brandId", "createdAt", "id", "jsonOutput", "updatedAt", "uploadedFileId" FROM "ReferenceImageAnalysis";
DROP TABLE "ReferenceImageAnalysis";
ALTER TABLE "new_ReferenceImageAnalysis" RENAME TO "ReferenceImageAnalysis";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
