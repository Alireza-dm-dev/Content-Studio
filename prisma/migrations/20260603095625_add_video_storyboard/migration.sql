-- CreateTable
CREATE TABLE "VideoStoryboard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT,
    "calendarId" TEXT,
    "calendarPostId" TEXT,
    "rawInput" TEXT,
    "storyboardOutput" TEXT,
    "approvedStoryboard" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoStoryboard_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoStoryboard_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoStoryboard_calendarPostId_fkey" FOREIGN KEY ("calendarPostId") REFERENCES "CalendarPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
