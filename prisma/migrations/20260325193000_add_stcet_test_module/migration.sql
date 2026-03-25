-- Create enums
CREATE TYPE "StcetTestStatus" AS ENUM ('ACTIVE', 'CLOSED', 'INACTIVE');
CREATE TYPE "StcetQuestionType" AS ENUM ('MCQ', 'CODING');
CREATE TYPE "StcetAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');
CREATE TYPE "StcetReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_REVIEW', 'REVIEWED');

-- Create tables
CREATE TABLE "StcetTest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "status" "StcetTestStatus" NOT NULL DEFAULT 'INACTIVE',
    "durationMinutes" INTEGER NOT NULL,
    "totalMarks" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StcetTest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StcetTestQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "type" "StcetQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "marks" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "correctOption" TEXT,
    "codingLanguage" TEXT,
    "maxScreenshots" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StcetTestQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StcetTestAttempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "StcetAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "reviewStatus" "StcetReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "autoScore" INTEGER NOT NULL DEFAULT 0,
    "manualScore" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "totalMarks" INTEGER NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generalFeedback" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "timeTakenSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StcetTestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StcetTestAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOption" TEXT,
    "codeAnswer" TEXT,
    "submittedLanguage" TEXT,
    "screenshotUrls" JSONB NOT NULL DEFAULT '[]',
    "isCorrect" BOOLEAN,
    "autoAwardedMarks" INTEGER NOT NULL DEFAULT 0,
    "manualAwardedMarks" INTEGER,
    "finalAwardedMarks" INTEGER NOT NULL DEFAULT 0,
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StcetTestAnswer_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "StcetTest_status_idx" ON "StcetTest"("status");
CREATE INDEX "StcetTest_startsAt_idx" ON "StcetTest"("startsAt");
CREATE INDEX "StcetTest_endsAt_idx" ON "StcetTest"("endsAt");
CREATE INDEX "StcetTest_createdAt_idx" ON "StcetTest"("createdAt");

CREATE INDEX "StcetTestQuestion_testId_idx" ON "StcetTestQuestion"("testId");
CREATE INDEX "StcetTestQuestion_type_idx" ON "StcetTestQuestion"("type");
CREATE INDEX "StcetTestQuestion_sortOrder_idx" ON "StcetTestQuestion"("sortOrder");

CREATE UNIQUE INDEX "StcetTestAttempt_testId_userId_key" ON "StcetTestAttempt"("testId", "userId");
CREATE INDEX "StcetTestAttempt_testId_idx" ON "StcetTestAttempt"("testId");
CREATE INDEX "StcetTestAttempt_userId_idx" ON "StcetTestAttempt"("userId");
CREATE INDEX "StcetTestAttempt_status_idx" ON "StcetTestAttempt"("status");
CREATE INDEX "StcetTestAttempt_reviewStatus_idx" ON "StcetTestAttempt"("reviewStatus");
CREATE INDEX "StcetTestAttempt_submittedAt_idx" ON "StcetTestAttempt"("submittedAt");

CREATE UNIQUE INDEX "StcetTestAnswer_attemptId_questionId_key" ON "StcetTestAnswer"("attemptId", "questionId");
CREATE INDEX "StcetTestAnswer_attemptId_idx" ON "StcetTestAnswer"("attemptId");
CREATE INDEX "StcetTestAnswer_questionId_idx" ON "StcetTestAnswer"("questionId");

-- Add foreign keys
ALTER TABLE "StcetTestQuestion"
ADD CONSTRAINT "StcetTestQuestion_testId_fkey"
FOREIGN KEY ("testId") REFERENCES "StcetTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StcetTestAttempt"
ADD CONSTRAINT "StcetTestAttempt_testId_fkey"
FOREIGN KEY ("testId") REFERENCES "StcetTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StcetTestAttempt"
ADD CONSTRAINT "StcetTestAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StcetTestAnswer"
ADD CONSTRAINT "StcetTestAnswer_attemptId_fkey"
FOREIGN KEY ("attemptId") REFERENCES "StcetTestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StcetTestAnswer"
ADD CONSTRAINT "StcetTestAnswer_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "StcetTestQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
