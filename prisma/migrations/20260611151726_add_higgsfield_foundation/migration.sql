-- CreateTable
CREATE TABLE "HiggsfieldModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "tokenCost" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OperatorTokenBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'higgsfield',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TokenLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'higgsfield',
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "higgsfieldModelId" TEXT,
    "generatedMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenLedgerEntry_higgsfieldModelId_fkey" FOREIGN KEY ("higgsfieldModelId") REFERENCES "HiggsfieldModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TokenLedgerEntry_generatedMediaId_fkey" FOREIGN KEY ("generatedMediaId") REFERENCES "GeneratedMedia" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generatedPromptId" TEXT,
    "brandId" TEXT,
    "calendarPostId" TEXT,
    "higgsfieldModelId" TEXT,
    "mediaType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalJobId" TEXT,
    "filePath" TEXT,
    "remoteUrl" TEXT,
    "sourcePrompt" TEXT,
    "tokenCost" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedMedia_generatedPromptId_fkey" FOREIGN KEY ("generatedPromptId") REFERENCES "GeneratedPrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedMedia_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedMedia_calendarPostId_fkey" FOREIGN KEY ("calendarPostId") REFERENCES "CalendarPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedMedia_higgsfieldModelId_fkey" FOREIGN KEY ("higgsfieldModelId") REFERENCES "HiggsfieldModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HiggsfieldModel_modelKey_key" ON "HiggsfieldModel"("modelKey");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorTokenBalance_provider_key" ON "OperatorTokenBalance"("provider");
