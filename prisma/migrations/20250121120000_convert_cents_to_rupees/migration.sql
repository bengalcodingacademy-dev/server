-- Convert cents to rupees in all tables
-- This migration converts existing cent values to rupees by dividing by 100

-- Add new columns for rupees
ALTER TABLE "Course" ADD COLUMN "priceRupees" DECIMAL(10,2);
ALTER TABLE "Course" ADD COLUMN "monthlyFeeRupees" DECIMAL(10,2);
ALTER TABLE "Purchase" ADD COLUMN "amountRupees" DECIMAL(10,2);
ALTER TABLE "MonthlyPurchase" ADD COLUMN "amountRupees" DECIMAL(10,2);

-- Convert existing data from cents to rupees
UPDATE "Course" SET "priceRupees" = "priceCents" / 100.0 WHERE "priceCents" IS NOT NULL;
UPDATE "Course" SET "monthlyFeeRupees" = "monthlyFeeCents" / 100.0 WHERE "monthlyFeeCents" IS NOT NULL;
UPDATE "Purchase" SET "amountRupees" = "amountCents" / 100.0 WHERE "amountCents" IS NOT NULL;
UPDATE "MonthlyPurchase" SET "amountRupees" = "amountCents" / 100.0 WHERE "amountCents" IS NOT NULL;

-- Make the new columns NOT NULL where appropriate
ALTER TABLE "Course" ALTER COLUMN "priceRupees" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "amountRupees" SET NOT NULL;
ALTER TABLE "MonthlyPurchase" ALTER COLUMN "amountRupees" SET NOT NULL;

-- Drop the old cent columns
ALTER TABLE "Course" DROP COLUMN "priceCents";
ALTER TABLE "Course" DROP COLUMN "monthlyFeeCents";
ALTER TABLE "Purchase" DROP COLUMN "amountCents";
ALTER TABLE "MonthlyPurchase" DROP COLUMN "amountCents";
