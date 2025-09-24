-- Migration: Convert cents to rupees
-- This migration safely converts existing cent values to rupees by dividing by 100

-- Step 1: Add new columns for rupees (nullable initially)
ALTER TABLE "Course" ADD COLUMN "priceRupees" DECIMAL(10,2);
ALTER TABLE "Course" ADD COLUMN "monthlyFeeRupees" DECIMAL(10,2);
ALTER TABLE "Purchase" ADD COLUMN "amountRupees" DECIMAL(10,2);
ALTER TABLE "MonthlyPurchase" ADD COLUMN "amountRupees" DECIMAL(10,2);

-- Step 2: Convert existing data from cents to rupees
-- Convert Course prices
UPDATE "Course" 
SET "priceRupees" = "priceCents" / 100.0 
WHERE "priceCents" IS NOT NULL;

UPDATE "Course" 
SET "monthlyFeeRupees" = "monthlyFeeCents" / 100.0 
WHERE "monthlyFeeCents" IS NOT NULL;

-- Convert Purchase amounts
UPDATE "Purchase" 
SET "amountRupees" = "amountCents" / 100.0 
WHERE "amountCents" IS NOT NULL;

-- Convert MonthlyPurchase amounts
UPDATE "MonthlyPurchase" 
SET "amountRupees" = "amountCents" / 100.0 
WHERE "amountCents" IS NOT NULL;

-- Step 3: Set default values for any NULL entries
UPDATE "Course" SET "priceRupees" = 0.00 WHERE "priceRupees" IS NULL;
UPDATE "Purchase" SET "amountRupees" = 0.00 WHERE "amountRupees" IS NULL;
UPDATE "MonthlyPurchase" SET "amountRupees" = 0.00 WHERE "amountRupees" IS NULL;

-- Step 4: Make the new columns NOT NULL where required
ALTER TABLE "Course" ALTER COLUMN "priceRupees" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "amountRupees" SET NOT NULL;
ALTER TABLE "MonthlyPurchase" ALTER COLUMN "amountRupees" SET NOT NULL;

-- Step 5: Drop the old cent columns
ALTER TABLE "Course" DROP COLUMN "priceCents";
ALTER TABLE "Course" DROP COLUMN "monthlyFeeCents";
ALTER TABLE "Purchase" DROP COLUMN "amountCents";
ALTER TABLE "MonthlyPurchase" DROP COLUMN "amountCents";
