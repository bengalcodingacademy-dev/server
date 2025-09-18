-- CreateTable
CREATE TABLE "public"."course_content" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "topicName" TEXT NOT NULL,
    "videoLink" TEXT,
    "githubRepo" TEXT,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_content_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."course_content" ADD CONSTRAINT "course_content_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
