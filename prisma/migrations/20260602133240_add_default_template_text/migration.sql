/*
  Warnings:

  - Added the required column `defaultTemplateText` to the `PromptTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "templateText" TEXT NOT NULL,
    "defaultTemplateText" TEXT NOT NULL,
    "outputType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PromptTemplate" ("category", "createdAt", "id", "name", "outputType", "slug", "templateText", "defaultTemplateText", "updatedAt") SELECT "category", "createdAt", "id", "name", "outputType", "slug", "templateText", "templateText", "updatedAt" FROM "PromptTemplate";
DROP TABLE "PromptTemplate";
ALTER TABLE "new_PromptTemplate" RENAME TO "PromptTemplate";
CREATE UNIQUE INDEX "PromptTemplate_slug_key" ON "PromptTemplate"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
