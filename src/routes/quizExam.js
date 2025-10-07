import { Router } from 'express';
import { z } from 'zod';

const quizExamRouter = (prisma) => {
  const router = Router();

  // Validation schemas
  const createQuizExamSchema = z.object({
    courseId: z.string().uuid(),
    monthNumber: z.number().int().min(1).max(12),
    lessonId: z.string().uuid().optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
    title: z.string().min(1).max(255),
    totalMarks: z.number().int().min(0).default(0),
    durationMinutes: z.number().int().min(1).max(300).default(30),
    isActive: z.boolean().default(true)
  });

  const updateQuizExamSchema = createQuizExamSchema.partial();

  const createQuestionSchema = z.object({
    quizId: z.string().uuid(),
    questionText: z.string().min(1),
    options: z.array(z.string()).min(2),
    correctAnswer: z.string().min(1),
    marks: z.number().int().min(1).default(1),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM')
  });

  const updateQuestionSchema = createQuestionSchema.partial().omit({ quizId: true });

  const submitAttemptSchema = z.object({
    answers: z.record(z.string(), z.string()) // questionId -> answer
  });

  // Quiz Exam Management Routes

  // GET /api/quiz-exams - List all quiz exams
  router.get('/', async (req, res, next) => {
    try {
      const { courseId, monthNumber, isActive } = req.query;
      
      const where = {};
      if (courseId) where.courseId = courseId;
      if (monthNumber) where.monthNumber = parseInt(monthNumber);
      if (isActive !== undefined) where.isActive = isActive === 'true';

      const quizExams = await prisma.quizExam.findMany({
        where,
        include: {
          course: {
            select: { id: true, title: true, slug: true }
          },
          lesson: {
            select: { id: true, topicName: true }
          },
          questions: {
            select: { id: true, questionText: true, marks: true, difficulty: true }
          },
          attempts: {
            select: { id: true, userId: true, score: true, percentage: true, submittedAt: true }
          },
          analytics: true
        },
        orderBy: [
          { courseId: 'asc' },
          { monthNumber: 'asc' },
          { createdAt: 'desc' }
        ]
      });

      res.json(quizExams);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/quiz-exams/:id - Get specific quiz exam
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      const quizExam = await prisma.quizExam.findUnique({
        where: { id },
        include: {
          course: {
            select: { id: true, title: true, slug: true }
          },
          lesson: {
            select: { id: true, topicName: true }
          },
          questions: {
            orderBy: { createdAt: 'asc' }
          },
          attempts: {
            include: {
              user: {
                select: { id: true, name: true, email: true }
              }
            },
            orderBy: { score: 'desc' }
          },
          analytics: true
        }
      });

      if (!quizExam) {
        return res.status(404).json({ error: 'Quiz exam not found' });
      }

      res.json(quizExam);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/quiz-exams - Create new quiz exam
  router.post('/', async (req, res, next) => {
    try {
      const data = createQuizExamSchema.parse(req.body);

      const quizExam = await prisma.quizExam.create({
        data,
        include: {
          course: {
            select: { id: true, title: true, slug: true }
          },
          lesson: {
            select: { id: true, topicName: true }
          }
        }
      });

      res.status(201).json(quizExam);
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/quiz-exams/:id - Update quiz exam
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const data = updateQuizExamSchema.parse(req.body);

      const quizExam = await prisma.quizExam.update({
        where: { id },
        data,
        include: {
          course: {
            select: { id: true, title: true, slug: true }
          },
          lesson: {
            select: { id: true, topicName: true }
          },
          questions: true
        }
      });

      res.json(quizExam);
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/quiz-exams/:id - Delete quiz exam
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      await prisma.quizExam.delete({
        where: { id }
      });

      res.json({ success: true, message: 'Quiz exam deleted successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Question Management Routes

  // POST /api/quiz-exams/:quizId/questions - Add question to quiz
  router.post('/:quizId/questions', async (req, res, next) => {
    try {
      const { quizId } = req.params;
      const data = createQuestionSchema.parse({ ...req.body, quizId });

      const question = await prisma.quizExamQuestion.create({
        data,
        include: {
          quiz: {
            select: { id: true, title: true }
          }
        }
      });

      // Update quiz total marks
      const quiz = await prisma.quizExam.findUnique({
        where: { id: quizId },
        include: { questions: true }
      });

      const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);
      await prisma.quizExam.update({
        where: { id: quizId },
        data: { totalMarks }
      });

      res.status(201).json(question);
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/quiz-exams/questions/:questionId - Update question
  router.put('/questions/:questionId', async (req, res, next) => {
    try {
      const { questionId } = req.params;
      const data = updateQuestionSchema.parse(req.body);

      const question = await prisma.quizExamQuestion.update({
        where: { id: questionId },
        data,
        include: {
          quiz: {
            select: { id: true, title: true }
          }
        }
      });

      // Update quiz total marks
      const quiz = await prisma.quizExam.findUnique({
        where: { id: question.quizId },
        include: { questions: true }
      });

      const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);
      await prisma.quizExam.update({
        where: { id: question.quizId },
        data: { totalMarks }
      });

      res.json(question);
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/quiz-exams/questions/:questionId - Delete question
  router.delete('/questions/:questionId', async (req, res, next) => {
    try {
      const { questionId } = req.params;

      const question = await prisma.quizExamQuestion.findUnique({
        where: { id: questionId },
        select: { quizId: true }
      });

      if (!question) {
        return res.status(404).json({ error: 'Question not found' });
      }

      await prisma.quizExamQuestion.delete({
        where: { id: questionId }
      });

      // Update quiz total marks
      const quiz = await prisma.quizExam.findUnique({
        where: { id: question.quizId },
        include: { questions: true }
      });

      const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);
      await prisma.quizExam.update({
        where: { id: question.quizId },
        data: { totalMarks }
      });

      res.json({ success: true, message: 'Question deleted successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Quiz Attempt Routes

  // POST /api/quiz-exams/:quizId/start - Start quiz attempt
  router.post('/:quizId/start', async (req, res, next) => {
    try {
      const { quizId } = req.params;
      const userId = req.user.id;

      // Check if user has already attempted this quiz
      const existingAttempt = await prisma.quizExamAttempt.findFirst({
        where: {
          quizId,
          userId,
          submittedAt: null
        }
      });

      if (existingAttempt) {
        return res.json(existingAttempt);
      }

      // Get quiz details
      const quiz = await prisma.quizExam.findUnique({
        where: { id: quizId },
        include: { questions: true }
      });

      if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
      }

      if (!quiz.isActive) {
        return res.status(400).json({ error: 'Quiz is not active' });
      }

      // Create new attempt
      const attempt = await prisma.quizExamAttempt.create({
        data: {
          quizId,
          userId,
          totalMarks: quiz.totalMarks,
          startedAt: new Date()
        }
      });

      res.status(201).json(attempt);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/quiz-exams/:quizId/submit - Submit quiz attempt
  router.post('/:quizId/submit', async (req, res, next) => {
    try {
      const { quizId } = req.params;
      const userId = req.user.id;
      const { answers } = submitAttemptSchema.parse(req.body);

      // Get current attempt
      const attempt = await prisma.quizExamAttempt.findFirst({
        where: {
          quizId,
          userId,
          submittedAt: null
        }
      });

      if (!attempt) {
        return res.status(404).json({ error: 'No active attempt found' });
      }

      // Get quiz questions
      const quiz = await prisma.quizExam.findUnique({
        where: { id: quizId },
        include: { questions: true }
      });

      if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
      }

      // Calculate score
      let score = 0;
      const questionResults = {};

      for (const question of quiz.questions) {
        const userAnswer = answers[question.id];
        const isCorrect = userAnswer === question.correctAnswer;
        
        if (isCorrect) {
          score += question.marks;
        }

        questionResults[question.id] = {
          userAnswer,
          correctAnswer: question.correctAnswer,
          isCorrect,
          marks: isCorrect ? question.marks : 0
        };
      }

      const percentage = quiz.totalMarks > 0 ? (score / quiz.totalMarks) * 100 : 0;

      // Update attempt
      const updatedAttempt = await prisma.quizExamAttempt.update({
        where: { id: attempt.id },
        data: {
          score,
          percentage,
          submittedAt: new Date(),
          details: questionResults
        }
      });

      // Calculate rank
      const allAttempts = await prisma.quizExamAttempt.findMany({
        where: {
          quizId,
          submittedAt: { not: null }
        },
        orderBy: { score: 'desc' }
      });

      const rank = allAttempts.findIndex(a => a.id === updatedAttempt.id) + 1;

      await prisma.quizExamAttempt.update({
        where: { id: updatedAttempt.id },
        data: { rank }
      });

      // Update analytics
      await updateQuizAnalytics(prisma, quizId);

      res.json({
        ...updatedAttempt,
        rank,
        questionResults
      });
    } catch (error) {
      next(error);
    }
  });


  // GET /api/quiz-exams/:quizId/analytics - Get quiz analytics
  router.get('/:quizId/analytics', async (req, res, next) => {
    try {
      const { quizId } = req.params;

      const analytics = await prisma.quizExamAnalytics.findUnique({
        where: { quizId },
        include: {
          topper: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      if (!analytics) {
        return res.status(404).json({ error: 'Analytics not found' });
      }

      res.json(analytics);
    } catch (error) {
      next(error);
    }
  });

  // Helper function to update quiz analytics
  async function updateQuizAnalytics(prisma, quizId) {
    const attempts = await prisma.quizExamAttempt.findMany({
      where: {
        quizId,
        submittedAt: { not: null }
      },
      orderBy: { score: 'desc' }
    });

    if (attempts.length === 0) return;

    const totalAttempts = attempts.length;
    const averageScore = attempts.reduce((sum, a) => sum + a.percentage, 0) / totalAttempts;
    const highestScore = attempts[0].percentage;
    const lowestScore = attempts[attempts.length - 1].percentage;
    const topperId = attempts[0].userId;

    await prisma.quizExamAnalytics.upsert({
      where: { quizId },
      update: {
        averageScore,
        highestScore,
        lowestScore,
        totalAttempts,
        topperId
      },
      create: {
        quizId,
        averageScore,
        highestScore,
        lowestScore,
        totalAttempts,
        topperId
      }
    });
  }

  // GET /api/quiz-exams/:quizId/leaderboard - Get quiz leaderboard
  router.get('/:quizId/leaderboard', async (req, res, next) => {
    try {
      const { quizId } = req.params;
      const userId = req.user?.id;

      // Get all attempts for this quiz, ordered by score descending
      const attempts = await prisma.quizExamAttempt.findMany({
        where: {
          quizId,
          submittedAt: { not: null }
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: [
          { percentage: 'desc' },
          { submittedAt: 'asc' } // Earlier submission wins in case of tie
        ]
      });

      // Get quiz details for total marks
      const quiz = await prisma.quizExam.findUnique({
        where: { id: quizId },
        select: { totalMarks: true }
      });

      if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
      }

      // Format leaderboard data
      const leaderboard = attempts.map((attempt, index) => ({
        id: attempt.id,
        rank: index + 1,
        user: attempt.user,
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        percentage: attempt.percentage,
        submittedAt: attempt.submittedAt
      }));

      // Find user's position if logged in
      let userPosition = null;
      if (userId) {
        const userAttempt = attempts.find(attempt => attempt.userId === userId);
        if (userAttempt) {
          const userRank = attempts.findIndex(attempt => attempt.userId === userId) + 1;
          userPosition = {
            rank: userRank,
            score: userAttempt.score,
            totalMarks: userAttempt.totalMarks,
            percentage: userAttempt.percentage,
            submittedAt: userAttempt.submittedAt
          };
        }
      }

      const response = {
        leaderboard,
        userPosition,
        totalAttempts: attempts.length
      };
      
      console.log('Leaderboard response:', JSON.stringify(response, null, 2));
      
      // Add cache-busting headers
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export { quizExamRouter };
