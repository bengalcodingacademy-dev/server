CREATE TYPE "AdmissionStatus" AS ENUM ('OPEN', 'CLOSED', 'COMING_SOON');

ALTER TABLE "Course"
ADD COLUMN "admissionStatus" "AdmissionStatus" NOT NULL DEFAULT 'COMING_SOON';