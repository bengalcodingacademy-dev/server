-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ALTER COLUMN "role" SET DEFAULT 'STUDENT';
