-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UploadedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "calendarPostId" TEXT,
    "calendarId" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "purpose" TEXT,
    "sizeBytes" INTEGER,
    "extractedText" TEXT,
    "extractionStatus" TEXT,
    "extractionError" TEXT,
    "wasTruncated" BOOLEAN NOT NULL DEFAULT false,
    "interpretationJson" JSONB,
    "interpretationStatus" TEXT,
    "interpretationError" TEXT,
    "interpretationModel" TEXT,
    "interpretedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UploadedFile_calendarPostId_fkey" FOREIGN KEY ("calendarPostId") REFERENCES "CalendarPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UploadedFile_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UploadedFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_UploadedFile" ("brandId", "calendarPostId", "createdAt", "fileName", "filePath", "fileType", "id", "purpose") SELECT "brandId", "calendarPostId", "createdAt", "fileName", "filePath", "fileType", "id", "purpose" FROM "UploadedFile";
DROP TABLE "UploadedFile";
ALTER TABLE "new_UploadedFile" RENAME TO "UploadedFile";
CREATE INDEX "UploadedFile_calendarId_idx" ON "UploadedFile"("calendarId");
CREATE INDEX "UploadedFile_calendarPostId_idx" ON "UploadedFile"("calendarPostId");
CREATE INDEX "UploadedFile_createdById_idx" ON "UploadedFile"("createdById");
CREATE INDEX "UploadedFile_expiresAt_idx" ON "UploadedFile"("expiresAt");
CREATE INDEX "UploadedFile_extractionStatus_idx" ON "UploadedFile"("extractionStatus");
CREATE INDEX "UploadedFile_interpretationStatus_idx" ON "UploadedFile"("interpretationStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
