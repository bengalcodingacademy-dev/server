-- AlterEnum
ALTER TYPE "public"."Role" ADD VALUE 'INSTRUCTOR';

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "age" INTEGER;
