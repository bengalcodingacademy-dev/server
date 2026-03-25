import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import { requireAuth, requireAdmin } from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const adminQuestionSchema = z
  .object({
    id: z.string().uuid().optional(),
    type: z.enum(["MCQ", "CODING"]),
    prompt: z.string().min(1),
    description: z.string().optional(),
    marks: z.number().int().min(1).max(100),
    sortOrder: z.number().int().min(0),
    options: z.array(z.string().min(1)).optional(),
    correctOption: z.string().optional(),
    codingLanguage: z.string().optional(),
    referenceScreenshotUrls: z.array(z.string().url()).max(3).optional(),
    maxScreenshots: z.number().int().min(0).max(3).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "MCQ") {
      if (!value.options || value.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ questions need at least two options",
          path: ["options"],
        });
      }

      if (!value.correctOption) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ questions need a correct option",
          path: ["correctOption"],
        });
      }
    }

    if (value.type === "CODING" && !value.codingLanguage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Coding questions need a language",
        path: ["codingLanguage"],
      });
    }
  });

const adminTestSchema = z
  .object({
    title: z.string().min(2).max(200),
    description: z.string().optional(),
    instructions: z.string().optional(),
    status: z.enum(["ACTIVE", "CLOSED", "INACTIVE"]),
    durationMinutes: z.number().int().min(1).max(600),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    questions: z.array(adminQuestionSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const startsAt = new Date(value.startsAt);
    const endsAt = new Date(value.endsAt);

    if (Number.isNaN(startsAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid start date",
        path: ["startsAt"],
      });
    }

    if (Number.isNaN(endsAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid end date",
        path: ["endsAt"],
      });
    }

    if (!Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime())) {
      if (endsAt <= startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date must be after start date",
          path: ["endsAt"],
        });
      }
    }
  });

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "CLOSED", "INACTIVE"]),
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOption: z.string().optional(),
        codeAnswer: z.string().optional(),
        submittedLanguage: z.string().optional(),
        screenshotUrls: z.array(z.string().url()).max(3).optional(),
      })
    )
    .default([]),
});

const reviewSchema = z.object({
  generalFeedback: z.string().max(4000).optional(),
  answers: z
    .array(
      z.object({
        answerId: z.string().uuid(),
        manualAwardedMarks: z.number().int().min(0),
        reviewerNotes: z.string().max(4000).optional(),
      })
    )
    .default([]),
});

const uploadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
});

function buildCookieOptions() {
  const isDevelopment = process.env.NODE_ENV !== "production";

  return {
    httpOnly: true,
    secure: !isDevelopment,
    sameSite: isDevelopment ? "lax" : "none",
  };
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeQuestion(question) {
  const options =
    question.type === "MCQ"
      ? (question.options || []).map((option) => option.trim()).filter(Boolean)
      : null;

  return {
    type: question.type,
    prompt: question.prompt.trim(),
    description: normalizeText(question.description),
    marks: question.marks,
    sortOrder: question.sortOrder,
    options,
    correctOption:
      question.type === "MCQ" ? normalizeText(question.correctOption) : null,
    codingLanguage:
      question.type === "CODING" ? normalizeText(question.codingLanguage) : null,
    referenceScreenshotUrls:
      question.type === "CODING"
        ? (question.referenceScreenshotUrls || []).slice(0, 3)
        : [],
    maxScreenshots: question.type === "CODING" ? question.maxScreenshots || 3 : 0,
  };
}

function calculateTotalMarks(questions) {
  return questions.reduce((sum, question) => sum + question.marks, 0);
}

let ensureStcetPublishColumnsPromise = null;

async function ensureStcetPublishColumns(prisma) {
  if (!ensureStcetPublishColumnsPromise) {
    ensureStcetPublishColumnsPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "StcetTest"
        ADD COLUMN IF NOT EXISTS "resultsPublishedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "resultsPublishedById" TEXT
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "StcetTest_resultsPublishedAt_idx"
        ON "StcetTest"("resultsPublishedAt")
      `);

      await prisma.$executeRawUnsafe(`
        ALTER TABLE "StcetTestQuestion"
        ADD COLUMN IF NOT EXISTS "referenceScreenshotUrls" JSONB
      `);
    })().catch((error) => {
      ensureStcetPublishColumnsPromise = null;
      throw error;
    });
  }

  return ensureStcetPublishColumnsPromise;
}

function isResultPublished(test) {
  return Boolean(test?.resultsPublishedAt);
}

function getStudentBucket(test, now = new Date()) {
  if (test.status === "INACTIVE") {
    return null;
  }

  if (test.status === "CLOSED") {
    return "closed";
  }

  const startsAt = new Date(test.startsAt);
  const endsAt = new Date(test.endsAt);

  if (now < startsAt) {
    return null;
  }

  if (now > endsAt) {
    return "closed";
  }

  return "open";
}

function mapAttemptSummary(attempt, resultVisible = false, resultsPublishedAt = null) {
  if (!attempt) {
    return null;
  }

  return {
    id: attempt.id,
    status: attempt.status,
    reviewStatus: attempt.reviewStatus,
    resultVisible,
    resultsPublishedAt,
    autoScore: resultVisible ? attempt.autoScore : null,
    manualScore: resultVisible ? attempt.manualScore : null,
    totalScore: resultVisible ? attempt.totalScore : null,
    totalMarks: resultVisible ? attempt.totalMarks : null,
    percentage: resultVisible ? attempt.percentage : null,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    reviewedAt: resultVisible ? attempt.reviewedAt : null,
    generalFeedback: resultVisible ? attempt.generalFeedback : null,
  };
}

function mapStudentQuestion(question) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    description: question.description,
    marks: question.marks,
    sortOrder: question.sortOrder,
    options: Array.isArray(question.options) ? question.options : [],
    codingLanguage: question.codingLanguage,
    referenceScreenshotUrls: Array.isArray(question.referenceScreenshotUrls)
      ? question.referenceScreenshotUrls
      : [],
    maxScreenshots: question.maxScreenshots,
  };
}

function mapStudentTest(test) {
  const latestAttempt = Array.isArray(test.attempts) ? test.attempts[0] : null;
  const resultVisible = isResultPublished(test);
  const bucket = getStudentBucket(test);
  const canAccess = bucket === "open" || Boolean(latestAttempt);

  return {
    id: test.id,
    title: test.title,
    description: test.description,
    instructions: test.instructions,
    status: test.status,
    durationMinutes: test.durationMinutes,
    totalMarks: test.totalMarks,
    startsAt: test.startsAt,
    endsAt: test.endsAt,
    canAccess,
    resultVisible,
    resultsPublishedAt: test.resultsPublishedAt,
    questionCount: test.questions?.length || 0,
    bucket,
    latestAttempt: mapAttemptSummary(
      latestAttempt,
      resultVisible,
      test.resultsPublishedAt
    ),
  };
}

function mapAdminQuestion(question) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    description: question.description,
    marks: question.marks,
    sortOrder: question.sortOrder,
    options: Array.isArray(question.options) ? question.options : [],
    correctOption: question.correctOption,
    codingLanguage: question.codingLanguage,
    referenceScreenshotUrls: Array.isArray(question.referenceScreenshotUrls)
      ? question.referenceScreenshotUrls
      : [],
    maxScreenshots: question.maxScreenshots,
  };
}

async function getAttemptPayload(prisma, attemptId, userId, isAdmin = false) {
  const attempt = await prisma.stcetTestAttempt.findUnique({
    where: { id: attemptId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      test: {
        include: {
          questions: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      answers: {
        include: {
          question: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!attempt) {
    return null;
  }

  if (!isAdmin && attempt.userId !== userId) {
    return null;
  }

  const resultVisible = isAdmin || isResultPublished(attempt.test);

  return {
    id: attempt.id,
    status: attempt.status,
    reviewStatus: attempt.reviewStatus,
    resultVisible,
    resultsPublishedAt: attempt.test.resultsPublishedAt,
    autoScore: resultVisible ? attempt.autoScore : null,
    manualScore: resultVisible ? attempt.manualScore : null,
    totalScore: resultVisible ? attempt.totalScore : null,
    totalMarks: resultVisible ? attempt.totalMarks : null,
    percentage: resultVisible ? attempt.percentage : null,
    generalFeedback: resultVisible ? attempt.generalFeedback : null,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    reviewedAt: resultVisible ? attempt.reviewedAt : null,
    timeTakenSeconds: attempt.timeTakenSeconds,
    user: isAdmin ? attempt.user : undefined,
    test: {
      id: attempt.test.id,
      title: attempt.test.title,
      description: attempt.test.description,
      instructions: attempt.test.instructions,
      status: attempt.test.status,
      durationMinutes: attempt.test.durationMinutes,
      startsAt: attempt.test.startsAt,
      endsAt: attempt.test.endsAt,
      totalMarks: attempt.test.totalMarks,
      resultsPublishedAt: attempt.test.resultsPublishedAt,
      questions: attempt.test.questions.map((question) =>
        isAdmin ? mapAdminQuestion(question) : mapStudentQuestion(question)
      ),
    },
    answers: attempt.answers.map((answer) => ({
      id: answer.id,
      questionId: answer.questionId,
      selectedOption: answer.selectedOption,
      codeAnswer: answer.codeAnswer,
      submittedLanguage: answer.submittedLanguage,
      screenshotUrls: Array.isArray(answer.screenshotUrls)
        ? answer.screenshotUrls
        : [],
      isCorrect: answer.isCorrect,
      autoAwardedMarks: resultVisible || isAdmin ? answer.autoAwardedMarks : null,
      manualAwardedMarks:
        resultVisible || isAdmin ? answer.manualAwardedMarks : null,
      finalAwardedMarks:
        resultVisible || isAdmin ? answer.finalAwardedMarks : null,
      reviewerNotes: resultVisible || isAdmin ? answer.reviewerNotes : null,
      question: isAdmin
        ? mapAdminQuestion(answer.question)
        : mapStudentQuestion(answer.question),
    })),
  };
}

async function getRankInfo(prisma, testId, userId) {
  const attempts = await prisma.stcetTestAttempt.findMany({
    where: {
      testId,
      status: "SUBMITTED",
    },
    select: {
      id: true,
      userId: true,
      totalScore: true,
      totalMarks: true,
      submittedAt: true,
    },
    orderBy: [{ totalScore: "desc" }, { submittedAt: "asc" }],
  });

  const rankIndex = attempts.findIndex((attempt) => attempt.userId === userId);
  if (rankIndex === -1) {
    return null;
  }

  const rankedAttempt = attempts[rankIndex];

  return {
    rank: rankIndex + 1,
    totalParticipants: attempts.length,
    score: rankedAttempt.totalScore,
    totalMarks: rankedAttempt.totalMarks,
    submittedAt: rankedAttempt.submittedAt,
  };
}

async function getLeaderboard(prisma, testId, limit = 10) {
  const attempts = await prisma.stcetTestAttempt.findMany({
    where: {
      testId,
      status: "SUBMITTED",
    },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ totalScore: "desc" }, { submittedAt: "asc" }],
    take: limit,
  });

  return attempts.map((attempt, index) => ({
    rank: index + 1,
    name: attempt.user?.name || "Student",
    score: attempt.totalScore,
    totalMarks: attempt.totalMarks,
    percentage: attempt.percentage,
  }));
}

export function stcetRouter(prisma) {
  const router = express.Router();
  const s3 = new S3Client({
    region: process.env.S3_REGION,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
  });

  router.use(async (_req, _res, next) => {
    try {
      await ensureStcetPublishColumns(prisma);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!user.emailVerifiedAt) {
        return res
          .status(403)
          .json({ error: "Please verify your email before logging in." });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const tokenExpiration = user.role === "ADMIN" ? "8h" : "1h";
      const maxAge = user.role === "ADMIN" ? 8 * 60 * 60 * 1000 : 60 * 60 * 1000;

      const accessToken = jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
        algorithm: "HS256",
        expiresIn: tokenExpiration,
        subject: user.id,
      });

      res.cookie("accessToken", accessToken, {
        ...buildCookieOptions(),
        maxAge,
      });

      res.json({
        expiresInSec: user.role === "ADMIN" ? 28800 : 3600,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", async (req, res) => {
    res.clearCookie("accessToken", buildCookieOptions());
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });

      res.json({
        authenticated: Boolean(user),
        user,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tests/dashboard", requireAuth, async (req, res, next) => {
    try {
      const tests = await prisma.stcetTest.findMany({
        where: {
          status: {
            in: ["ACTIVE", "CLOSED"],
          },
        },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      });

      const summary = tests.reduce(
        (counts, test) => {
          const bucket = getStudentBucket(test);
          if (bucket === "open") {
            counts.open += 1;
          }
          if (bucket === "closed") {
            counts.closed += 1;
          }
          return counts;
        },
        { open: 0, closed: 0 }
      );

      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tests", requireAuth, async (req, res, next) => {
    try {
      const bucket = req.query.bucket === "closed" ? "closed" : "open";

      const tests = await prisma.stcetTest.findMany({
        where: {
          status: {
            in: ["ACTIVE", "CLOSED", "INACTIVE"],
          },
        },
        include: {
          questions: {
            select: {
              id: true,
            },
          },
          attempts: {
            where: {
              userId: req.user.id,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
      });

      const filtered = tests
        .map((test) => mapStudentTest(test))
        .filter((test) => test.bucket === bucket);

      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tests/:id", requireAuth, async (req, res, next) => {
    try {
      const test = await prisma.stcetTest.findUnique({
        where: { id: req.params.id },
        include: {
          questions: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          attempts: {
            where: {
              userId: req.user.id,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
      });

      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const bucket = getStudentBucket(test);
      const latestAttempt = test.attempts[0];

      if (!bucket && !latestAttempt) {
        return res.status(404).json({ error: "Test not available" });
      }

      if (bucket === "closed" && !latestAttempt) {
        return res.status(403).json({
          error: "You can only view closed tests that you attempted",
        });
      }

      res.json({
        ...mapStudentTest(test),
        questions: test.questions.map(mapStudentQuestion),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tests/:id/start", requireAuth, async (req, res, next) => {
    try {
      const test = await prisma.stcetTest.findUnique({
        where: { id: req.params.id },
        include: {
          questions: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      });

      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      if (getStudentBucket(test) !== "open") {
        return res.status(400).json({ error: "This test is not open right now" });
      }

      const existingAttempt = await prisma.stcetTestAttempt.findUnique({
        where: {
          testId_userId: {
            testId: test.id,
            userId: req.user.id,
          },
        },
      });

      if (existingAttempt?.status === "SUBMITTED") {
        return res.status(409).json({
          error: "You have already submitted this test",
          attemptId: existingAttempt.id,
        });
      }

      const attempt =
        existingAttempt ||
        (await prisma.stcetTestAttempt.create({
          data: {
            testId: test.id,
            userId: req.user.id,
            totalMarks: test.totalMarks,
            reviewStatus: "NOT_REQUIRED",
          },
        }));

      const payload = await getAttemptPayload(prisma, attempt.id, req.user.id);
      res.status(existingAttempt ? 200 : 201).json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post("/tests/:id/submit", requireAuth, async (req, res, next) => {
    try {
      const { answers } = submitSchema.parse(req.body);

      const attempt = await prisma.stcetTestAttempt.findUnique({
        where: {
          testId_userId: {
            testId: req.params.id,
            userId: req.user.id,
          },
        },
        include: {
          test: {
            include: {
              questions: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      });

      if (!attempt) {
        return res.status(404).json({ error: "No active attempt found" });
      }

      if (attempt.status === "SUBMITTED") {
        return res.status(409).json({ error: "Test already submitted" });
      }

      const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
      const hasCodingQuestions = attempt.test.questions.some(
        (question) => question.type === "CODING"
      );

      let autoScore = 0;
      const answerRows = [];

      for (const question of attempt.test.questions) {
        const incoming = answerMap.get(question.id);
        const screenshotUrls = Array.isArray(incoming?.screenshotUrls)
          ? incoming.screenshotUrls
          : [];

        if (question.type === "MCQ") {
          const selectedOption = normalizeText(incoming?.selectedOption);
          const isCorrect = selectedOption === question.correctOption;
          const awardedMarks = isCorrect ? question.marks : 0;
          autoScore += awardedMarks;

          answerRows.push({
            questionId: question.id,
            selectedOption,
            isCorrect,
            autoAwardedMarks: awardedMarks,
            finalAwardedMarks: awardedMarks,
          });
          continue;
        }

        if (screenshotUrls.length > question.maxScreenshots) {
          return res.status(400).json({
            error: `Question ${question.sortOrder + 1} allows only ${
              question.maxScreenshots
            } screenshots`,
          });
        }

        answerRows.push({
          questionId: question.id,
          codeAnswer: incoming?.codeAnswer || "",
          submittedLanguage:
            normalizeText(incoming?.submittedLanguage) || question.codingLanguage,
          screenshotUrls,
          autoAwardedMarks: 0,
          finalAwardedMarks: 0,
        });
      }

      const manualScore = 0;
      const totalScore = autoScore + manualScore;
      const totalMarks = attempt.test.totalMarks;
      const percentage = totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0;
      const startedAt = new Date(attempt.startedAt);
      const timeTakenSeconds = Math.max(
        0,
        Math.round((Date.now() - startedAt.getTime()) / 1000)
      );

      await prisma.$transaction(async (tx) => {
        await tx.stcetTestAnswer.deleteMany({
          where: {
            attemptId: attempt.id,
          },
        });

        await tx.stcetTestAnswer.createMany({
          data: answerRows.map((answer) => ({
            ...answer,
            attemptId: attempt.id,
          })),
        });

        await tx.stcetTestAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "SUBMITTED",
            reviewStatus: hasCodingQuestions ? "PENDING_REVIEW" : "REVIEWED",
            autoScore,
            manualScore,
            totalScore,
            totalMarks,
            percentage,
            timeTakenSeconds,
            submittedAt: new Date(),
            reviewedAt: hasCodingQuestions ? null : new Date(),
          },
        });
      });

      const payload = await getAttemptPayload(prisma, attempt.id, req.user.id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/attempts/:attemptId", requireAuth, async (req, res, next) => {
    try {
      const payload = await getAttemptPayload(
        prisma,
        req.params.attemptId,
        req.user.id
      );

      if (!payload) {
        return res.status(404).json({ error: "Attempt not found" });
      }

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tests/:id/rank", requireAuth, async (req, res, next) => {
    try {
      const test = await prisma.stcetTest.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          title: true,
          resultsPublishedAt: true,
        },
      });

      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      if (!isResultPublished(test)) {
        return res.status(400).json({ error: "Results have not been published yet" });
      }

      const rankInfo = await getRankInfo(prisma, test.id, req.user.id);
      if (!rankInfo) {
        return res.status(404).json({ error: "You have not submitted this test" });
      }

      res.json({
        ...rankInfo,
        testId: test.id,
        testTitle: test.title,
        resultsPublishedAt: test.resultsPublishedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tests/:id/result-summary", requireAuth, async (req, res, next) => {
    try {
      const test = await prisma.stcetTest.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          title: true,
          totalMarks: true,
          resultsPublishedAt: true,
          attempts: {
            where: {
              userId: req.user.id,
              status: "SUBMITTED",
            },
            take: 1,
            select: {
              id: true,
              totalScore: true,
              totalMarks: true,
              percentage: true,
              submittedAt: true,
              reviewedAt: true,
              generalFeedback: true,
            },
          },
        },
      });

      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      if (!isResultPublished(test)) {
        return res.status(400).json({ error: "Results have not been published yet" });
      }

      const studentAttempt = test.attempts[0];
      if (!studentAttempt) {
        return res.status(404).json({ error: "You have not submitted this test" });
      }

      const [rankInfo, leaderboard] = await Promise.all([
        getRankInfo(prisma, test.id, req.user.id),
        getLeaderboard(prisma, test.id, 10),
      ]);

      res.json({
        testId: test.id,
        testTitle: test.title,
        totalMarks: test.totalMarks,
        resultsPublishedAt: test.resultsPublishedAt,
        myResult: {
          attemptId: studentAttempt.id,
          score: studentAttempt.totalScore,
          totalMarks: studentAttempt.totalMarks,
          percentage: studentAttempt.percentage,
          submittedAt: studentAttempt.submittedAt,
          reviewedAt: studentAttempt.reviewedAt,
          generalFeedback: studentAttempt.generalFeedback,
        },
        rank: rankInfo,
        leaderboard,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/uploads/presign", requireAuth, async (req, res, next) => {
    try {
      const { fileName, fileType } = uploadSchema.parse(req.body);
      const bucket = process.env.S3_BUCKET;

      if (!bucket) {
        return res.status(500).json({ error: "S3 bucket not configured" });
      }

      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
      const key = `stcet/submissions/${req.user.id}/${Date.now()}-${safeFileName}`;

      const post = await createPresignedPost(s3, {
        Bucket: bucket,
        Key: key,
        Conditions: [["starts-with", "$Content-Type", "image/"]],
        Fields: {
          "Content-Type": fileType,
        },
        Expires: 300,
      });

      res.json({
        mode: "post",
        post,
        publicUrl: `https://d270a3f3iqnh9i.cloudfront.net/${key}`,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/tests", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const tests = await prisma.stcetTest.findMany({
        include: {
          questions: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          attempts: {
            select: {
              id: true,
              reviewStatus: true,
              status: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      });

      res.json(
        tests.map((test) => ({
          id: test.id,
          title: test.title,
          description: test.description,
          instructions: test.instructions,
          status: test.status,
          durationMinutes: test.durationMinutes,
          totalMarks: test.totalMarks,
          resultsPublishedAt: test.resultsPublishedAt,
          startsAt: test.startsAt,
          endsAt: test.endsAt,
          createdAt: test.createdAt,
          updatedAt: test.updatedAt,
          questionCount: test.questions.length,
          questions: test.questions.map(mapAdminQuestion),
          submissionCount: test.attempts.filter(
            (attempt) => attempt.status === "SUBMITTED"
          ).length,
          pendingReviewCount: test.attempts.filter(
            (attempt) => attempt.reviewStatus === "PENDING_REVIEW"
          ).length,
          resultsPublished: Boolean(test.resultsPublishedAt),
        }))
      );
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/admin/tests/:id",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const test = await prisma.stcetTest.findUnique({
          where: { id: req.params.id },
          include: {
            questions: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            attempts: {
              select: {
                id: true,
                status: true,
                reviewStatus: true,
                totalScore: true,
                percentage: true,
                submittedAt: true,
              },
            },
          },
        });

        if (!test) {
          return res.status(404).json({ error: "Test not found" });
        }

        res.json({
          id: test.id,
          title: test.title,
          description: test.description,
          instructions: test.instructions,
          status: test.status,
          durationMinutes: test.durationMinutes,
          totalMarks: test.totalMarks,
          resultsPublishedAt: test.resultsPublishedAt,
          startsAt: test.startsAt,
          endsAt: test.endsAt,
          questions: test.questions.map(mapAdminQuestion),
          attempts: test.attempts,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/admin/tests",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const data = adminTestSchema.parse(req.body);
        const questions = data.questions
          .map(normalizeQuestion)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const totalMarks = calculateTotalMarks(questions);

        const created = await prisma.stcetTest.create({
          data: {
            title: data.title.trim(),
            description: normalizeText(data.description),
            instructions: normalizeText(data.instructions),
            status: data.status,
            durationMinutes: data.durationMinutes,
            totalMarks,
            startsAt: new Date(data.startsAt),
            endsAt: new Date(data.endsAt),
            createdById: req.user.id,
            questions: {
              create: questions,
            },
          },
          include: {
            questions: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
          },
        });

        res.status(201).json({
          ...created,
          questions: created.questions.map(mapAdminQuestion),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    "/admin/tests/:id",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const data = adminTestSchema.parse(req.body);

        const existing = await prisma.stcetTest.findUnique({
          where: { id: req.params.id },
          include: {
            attempts: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!existing) {
          return res.status(404).json({ error: "Test not found" });
        }

        if (existing.attempts.length > 0) {
          return res.status(400).json({
            error:
              "This test already has submissions. You can only change its status now.",
          });
        }

        const questions = data.questions
          .map(normalizeQuestion)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const totalMarks = calculateTotalMarks(questions);

        const updated = await prisma.$transaction(async (tx) => {
          await tx.stcetTestQuestion.deleteMany({
            where: {
              testId: req.params.id,
            },
          });

          return tx.stcetTest.update({
            where: { id: req.params.id },
            data: {
              title: data.title.trim(),
              description: normalizeText(data.description),
              instructions: normalizeText(data.instructions),
              status: data.status,
              durationMinutes: data.durationMinutes,
              totalMarks,
              startsAt: new Date(data.startsAt),
              endsAt: new Date(data.endsAt),
              updatedById: req.user.id,
              questions: {
                create: questions,
              },
            },
            include: {
              questions: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          });
        });

        res.json({
          ...updated,
          questions: updated.questions.map(mapAdminQuestion),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/admin/tests/:id/status",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const { status } = updateStatusSchema.parse(req.body);

        const updated = await prisma.stcetTest.update({
          where: { id: req.params.id },
          data: {
            status,
            updatedById: req.user.id,
          },
        });

        res.json(updated);
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/admin/tests/:id",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const existing = await prisma.stcetTest.findUnique({
          where: { id: req.params.id },
          include: {
            attempts: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!existing) {
          return res.status(404).json({ error: "Test not found" });
        }

        const deletedAttemptCount = existing.attempts.length;

        await prisma.$transaction(async (tx) => {
          if (deletedAttemptCount > 0) {
            await tx.stcetTestAnswer.deleteMany({
              where: {
                attempt: {
                  testId: req.params.id,
                },
              },
            });

            await tx.stcetTestAttempt.deleteMany({
              where: {
                testId: req.params.id,
              },
            });
          }

          await tx.stcetTestQuestion.deleteMany({
            where: {
              testId: req.params.id,
            },
          });

          await tx.stcetTest.delete({
            where: { id: req.params.id },
          });
        });

        res.json({
          ok: true,
          deletedAttemptCount,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/admin/tests/:id/submissions",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const submissions = await prisma.stcetTestAttempt.findMany({
          where: {
            testId: req.params.id,
            status: "SUBMITTED",
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: [{ totalScore: "desc" }, { submittedAt: "asc" }],
        });

        const totalParticipants = submissions.length;

        res.json(
          submissions.map((submission, index) => ({
            id: submission.id,
            user: submission.user,
            reviewStatus: submission.reviewStatus,
            autoScore: submission.autoScore,
            manualScore: submission.manualScore,
            totalScore: submission.totalScore,
            totalMarks: submission.totalMarks,
            percentage: submission.percentage,
            submittedAt: submission.submittedAt,
            reviewedAt: submission.reviewedAt,
            rank: index + 1,
            totalParticipants,
          }))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/admin/submissions/:attemptId",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const payload = await getAttemptPayload(
          prisma,
          req.params.attemptId,
          req.user.id,
          true
        );

        if (!payload) {
          return res.status(404).json({ error: "Submission not found" });
        }

        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/admin/submissions/:attemptId/review",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const { answers, generalFeedback } = reviewSchema.parse(req.body);

        const attempt = await prisma.stcetTestAttempt.findUnique({
          where: { id: req.params.attemptId },
          include: {
            test: {
              select: {
                totalMarks: true,
              },
            },
            answers: {
              include: {
                question: true,
              },
            },
          },
        });

        if (!attempt) {
          return res.status(404).json({ error: "Submission not found" });
        }

        const reviewMap = new Map(answers.map((answer) => [answer.answerId, answer]));

        let manualScore = 0;

        await prisma.$transaction(async (tx) => {
          for (const answer of attempt.answers) {
            if (answer.question.type !== "CODING") {
              continue;
            }

            const review = reviewMap.get(answer.id);
            const awarded = Math.min(
              review?.manualAwardedMarks ?? 0,
              answer.question.marks
            );

            manualScore += awarded;

            await tx.stcetTestAnswer.update({
              where: { id: answer.id },
              data: {
                manualAwardedMarks: awarded,
                finalAwardedMarks: awarded,
                reviewerNotes: normalizeText(review?.reviewerNotes),
              },
            });
          }

          const totalScore = attempt.autoScore + manualScore;
          const percentage =
            attempt.test.totalMarks > 0
              ? (totalScore / attempt.test.totalMarks) * 100
              : 0;

          await tx.stcetTestAttempt.update({
            where: { id: attempt.id },
            data: {
              manualScore,
              totalScore,
              percentage,
              reviewStatus: "REVIEWED",
              reviewedAt: new Date(),
              generalFeedback: normalizeText(generalFeedback),
            },
          });
        });

        const payload = await getAttemptPayload(
          prisma,
          req.params.attemptId,
          req.user.id,
          true
        );

        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/admin/tests/:id/publish-results",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const test = await prisma.stcetTest.findUnique({
          where: { id: req.params.id },
          include: {
            attempts: {
              select: {
                id: true,
                status: true,
                reviewStatus: true,
              },
            },
          },
        });

        if (!test) {
          return res.status(404).json({ error: "Test not found" });
        }

        const pendingReviewCount = test.attempts.filter(
          (attempt) =>
            attempt.status === "SUBMITTED" &&
            attempt.reviewStatus === "PENDING_REVIEW"
        ).length;

        if (pendingReviewCount > 0) {
          return res.status(400).json({
            error: "Review all coding submissions before publishing results",
          });
        }

        const updated = await prisma.stcetTest.update({
          where: { id: req.params.id },
          data: {
            resultsPublishedAt: test.resultsPublishedAt || new Date(),
            resultsPublishedById: req.user.id,
            updatedById: req.user.id,
          },
        });

        res.json(updated);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
