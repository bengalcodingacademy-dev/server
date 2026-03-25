ALTER TABLE "StcetTest"
ADD COLUMN "resultsPublishedAt" TIMESTAMP(3),
ADD COLUMN "resultsPublishedById" TEXT;

CREATE INDEX "StcetTest_resultsPublishedAt_idx" ON "StcetTest"("resultsPublishedAt");
