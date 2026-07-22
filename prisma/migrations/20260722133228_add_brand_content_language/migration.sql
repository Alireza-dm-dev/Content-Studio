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
    "contentLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Brand" ("brandTone", "brandVisualStyle", "businessLocation", "businessType", "createdAt", "facebookPage", "id", "instagramPage", "linkedinPage", "mainServicesOrProducts", "name", "targetAudience", "updatedAt", "website") SELECT "brandTone", "brandVisualStyle", "businessLocation", "businessType", "createdAt", "facebookPage", "id", "instagramPage", "linkedinPage", "mainServicesOrProducts", "name", "targetAudience", "updatedAt", "website" FROM "Brand";
DROP TABLE "Brand";
ALTER TABLE "new_Brand" RENAME TO "Brand";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
