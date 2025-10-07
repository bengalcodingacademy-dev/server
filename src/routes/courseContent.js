import express from 'express';
import { z } from 'zod';

const contentSchema = z.object({
  courseId: z.string().uuid(),
  monthNumber: z.number().int().positive(),
  topicName: z.string().min(1).max(200),
  videoLink: z.string().optional().refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
    message: "Invalid URL format"
  }),
  githubRepo: z.string().optional().refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
    message: "Invalid URL format"
  }),
  notes: z.string().optional(),
  order: z.number().int().min(0).optional()
});

const updateContentSchema = z.object({
  topicName: z.string().min(1).max(200).optional(),
  videoLink: z.string().optional().refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
    message: "Invalid URL format"
  }),
  githubRepo: z.string().optional().refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
    message: "Invalid URL format"
  }),
  notes: z.string().optional(),
  order: z.number().int().min(0).optional()
});

export function courseContentRouter(prisma) {
  const router = express.Router();


  // Get all content for a course
  router.get('/course/:courseId', async (req, res, next) => {
    try {
      const { courseId } = req.params;
      
      const content = await prisma.courseContent.findMany({
        where: { courseId },
        select: {
          id: true,
          courseId: true,
          monthNumber: true,
          topicName: true,
          videoLink: true,
          githubRepo: true,
          notes: true,
          order: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [
          { monthNumber: 'asc' },
          { order: 'asc' }
        ]
      });
      
      // Set no-cache headers to ensure fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json(content);
    } catch (e) { next(e); }
  });

  // Get content for a specific month
  router.get('/course/:courseId/month/:monthNumber', async (req, res, next) => {
    try {
      const { courseId, monthNumber } = req.params;
      const month = parseInt(monthNumber);
      
      const content = await prisma.courseContent.findMany({
        where: { 
          courseId,
          monthNumber: month
        },
        select: {
          id: true,
          courseId: true,
          monthNumber: true,
          topicName: true,
          videoLink: true,
          githubRepo: true,
          notes: true,
          order: true,
          createdAt: true,
          updatedAt: true,
          quizExams: {
            where: { isActive: true },
            select: {
              id: true,
              title: true,
              durationMinutes: true,
              totalMarks: true,
              questions: {
                select: {
                  id: true,
                  questionText: true,
                  marks: true,
                  difficulty: true
                }
              }
            }
          }
        },
        orderBy: { order: 'asc' }
      });

      // Also get quiz exams for the entire month (not linked to specific lessons)
      const monthQuizExams = await prisma.quizExam.findMany({
        where: {
          courseId,
          monthNumber: month,
          isActive: true,
          lessonId: null // Quiz exams not linked to specific lessons
        },
        select: {
          id: true,
          title: true,
          durationMinutes: true,
          totalMarks: true,
          questions: {
            select: {
              id: true,
              questionText: true,
              marks: true,
              difficulty: true
            }
          }
        }
      });

      // Add month-level quiz exams to each content item
      const contentWithMonthQuizExams = content.map(item => ({
        ...item,
        quizExams: [...item.quizExams, ...monthQuizExams]
      }));
      
      // Set no-cache headers to ensure fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json(contentWithMonthQuizExams);
    } catch (e) { next(e); }
  });

  // Create new content
  router.post('/', async (req, res, next) => {
    try {
      console.log('Creating course content:', req.body);
      const data = contentSchema.parse(req.body);
      
      const content = await prisma.courseContent.create({
        data
      });
      
      console.log('Course content created successfully:', content.id);
      res.json(content);
    } catch (e) { 
      console.error('Error creating course content:', e);
      next(e); 
    }
  });

  // Update content
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      console.log('Updating course content:', id, req.body);
      const data = updateContentSchema.parse(req.body);
      
      const content = await prisma.courseContent.update({
        where: { id },
        data
      });
      
      console.log('Course content updated successfully:', content.id);
      res.json(content);
    } catch (e) { 
      console.error('Error updating course content:', e);
      next(e); 
    }
  });

  // Delete content
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      console.log('Deleting course content with ID:', id);
      
      const deletedContent = await prisma.courseContent.delete({
        where: { id }
      });
      
      console.log('Course content deleted successfully:', deletedContent.id);
      res.json({ success: true, deletedId: id });
    } catch (e) { 
      console.error('Error deleting course content:', e);
      next(e); 
    }
  });

  // Reorder content within a month
  router.put('/reorder', async (req, res, next) => {
    try {
      const { contentIds } = req.body; // Array of content IDs in new order
      
      const updates = contentIds.map((id, index) => 
        prisma.courseContent.update({
          where: { id },
          data: { order: index }
        })
      );
      
      await Promise.all(updates);
      
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  return router;
}
