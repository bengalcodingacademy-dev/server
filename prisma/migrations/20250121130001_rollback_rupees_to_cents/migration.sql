-- Rollback Migration: Convert rupees back to cents
-- This migration converts rupees back to cents by multiplying by 100

-- Step 1: Add back the cent columns
ALTER TABLE "Course" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "Course" ADD COLUMN "monthlyFeeCents" INTEGER;
ALTER TABLE "Purchase" ADD COLUMN "amountCents" INTEGER;
ALTER TABLE "MonthlyPurchase" ADD COLUMN "amountCents" INTEGER;

-- Step 2: Convert rupees back to cents
UPDATE "Course" 
SET "priceCents" = ROUND("priceRupees" * 100) 
WHERE "priceRupees" IS NOT NULL;

UPDATE "Course" 
SET "monthlyFeeCents" = ROUND("monthlyFeeRupees" * 100) 
WHERE "monthlyFeeRupees" IS NOT NULL;

UPDATE "Purchase" 
SET "amountCents" = ROUND("amountRupees" * 100) 
WHERE "amountRupees" IS NOT NULL;

UPDATE "MonthlyPurchase" 
SET "amountCents" = ROUND("amountRupees" * 100) 
WHERE "amountRupees" IS NOT NULL;

-- Step 3: Set default values for any NULL entries
UPDATE "Course" SET "priceCents" = 0 WHERE "priceCents" IS NULL;
UPDATE "Purchase" SET "amountCents" = 0 WHERE "amountCents" IS NULL;
UPDATE "MonthlyPurchase" SET "amountCents" = 0 WHERE "amountCents" IS NULL;

-- Step 4: Make the cent columns NOT NULL where required
ALTER TABLE "Course" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "MonthlyPurchase" ALTER COLUMN "amountCents" SET NOT NULL;

-- Step 5: Drop the rupee columns
ALTER TABLE "Course" DROP COLUMN "priceRupees";
ALTER TABLE "Course" DROP COLUMN "monthlyFeeRupees";
ALTER TABLE "Purchase" DROP COLUMN "amountRupees";
ALTER TABLE "MonthlyPurchase" DROP COLUMN "amountRupees";
