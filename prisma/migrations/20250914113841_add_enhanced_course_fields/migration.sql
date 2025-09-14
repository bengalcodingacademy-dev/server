-- AlterTable
ALTER TABLE "public"."Course" ADD COLUMN     "aboutCourse" TEXT,
ADD COLUMN     "courseIncludes" JSONB,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'bengali',
ADD COLUMN     "modulesJson" JSONB,
ADD COLUMN     "numberOfLectures" INTEGER,
ADD COLUMN     "numberOfModules" INTEGER,
ADD COLUMN     "numberOfStudents" INTEGER DEFAULT 0,
ADD COLUMN     "starRating" DOUBLE PRECISION DEFAULT 0.0;

-- AlterTable
ALTER TABLE "public"."Testimonial" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "studentAbout" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Testimonial" ADD CONSTRAINT "Testimonial_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
