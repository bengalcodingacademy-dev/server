import express from 'express';
import { z } from 'zod';

const contentSchema = z.object({
  courseId: z.string().uuid(),
  monthNumber: z.number().int().positive(),
  topicName: z.string().min(1).max(200),
  videoLink: z.string().url().optional().or(z.literal('')),
  githubRepo: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
  order: z.number().int().min(0).optional()
});

const updateContentSchema = z.object({
  topicName: z.string().min(1).max(200).optional(),
  videoLink: z.string().url().optional().or(z.literal('')),
  githubRepo: z.string().url().optional().or(z.literal('')),
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
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=300'); // Cache for 5 minutes
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
          updatedAt: true
        },
        orderBy: { order: 'asc' }
      });
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=300'); // Cache for 5 minutes
      res.json(content);
    } catch (e) { next(e); }
  });

  // Create new content
  router.post('/', async (req, res, next) => {
    try {
      const data = contentSchema.parse(req.body);
      
      const content = await prisma.courseContent.create({
        data
      });
      
      res.json(content);
    } catch (e) { next(e); }
  });

  // Update content
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const data = updateContentSchema.parse(req.body);
      
      const content = await prisma.courseContent.update({
        where: { id },
        data
      });
      
      res.json(content);
    } catch (e) { next(e); }
  });

  // Delete content
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      
      await prisma.courseContent.delete({
        where: { id }
      });
      
      res.json({ success: true });
    } catch (e) { next(e); }
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
