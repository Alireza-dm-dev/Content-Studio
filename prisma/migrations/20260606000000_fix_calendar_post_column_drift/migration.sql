-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "postNumber" INTEGER,
    "date" DATETIME,
    "platform" TEXT,
    "format" TEXT,
    "suggestedHook" TEXT,
    "mainAngleAndCoreMessage" TEXT,
    "suggestedCaption" TEXT,
    "hashtags" TEXT,
    "contentStructure" TEXT,
    "visualDirection" TEXT,
    "outputImageTextRequirements" TEXT,
    "inspirationSource" TEXT,
    "referenceLink" TEXT,
    "adaptationNote" TEXT,
    "contentOrigin" TEXT,
    "postData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarPost_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarPost" ("id", "calendarId", "postNumber", "date", "platform", "format", "suggestedHook", "mainAngleAndCoreMessage", "suggestedCaption", "hashtags", "contentStructure", "visualDirection", "outputImageTextRequirements", "inspirationSource", "referenceLink", "adaptationNote", "contentOrigin", "postData", "status", "createdAt", "updatedAt")
SELECT "id", "calendarId", "postNumber", "date", "platform", "format", "suggestedHook", "mainAngleAndCoreMessage", "suggestedCaption", "hashtags", "contentStructure", "visualDirection", "outputImageTextRequirements", "inspirationSource", "referenceLink", "adaptationNote", "contentOrigin", "postMetadata", "status", "createdAt", "updatedAt"
FROM "CalendarPost";
DROP TABLE "CalendarPost";
ALTER TABLE "new_CalendarPost" RENAME TO "CalendarPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
