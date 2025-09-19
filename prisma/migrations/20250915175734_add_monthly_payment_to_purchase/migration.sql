-- AlterTable
ALTER TABLE "public"."Purchase" ADD COLUMN     "isMonthlyPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthNumber" INTEGER,
ADD COLUMN     "totalMonths" INTEGER;
