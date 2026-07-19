-- CreateTable
CREATE TABLE "BrandMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'calendar_editor',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandMembership_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrandMembership_userId_idx" ON "BrandMembership"("userId");

-- CreateIndex
CREATE INDEX "BrandMembership_brandId_idx" ON "BrandMembership"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandMembership_userId_brandId_key" ON "BrandMembership"("userId", "brandId");
