import express from 'express';
import { z } from 'zod';

const createCourseSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  imageUrl: z.string().url().nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  shortDesc: z.string().min(2),
  longDesc: z.string().min(2),
  duration: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  roadmapJson: z.any().optional(),
  syllabusJson: z.any().optional(),
  isActive: z.boolean().optional()
});

export function coursesRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const courses = await prisma.course.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
      res.json(courses);
    } catch (e) { next(e); }
  });

  router.get('/:slug', async (req, res, next) => {
    try {
      const course = await prisma.course.findUnique({ where: { slug: req.params.slug } });
      if (!course || !course.isActive) return res.status(404).json({ error: 'Not found' });
      res.json(course);
    } catch (e) { next(e); }
  });

  router.get('/id/:id', async (req, res, next) => {
    try {
      const course = await prisma.course.findUnique({ where: { id: req.params.id } });
      if (!course || !course.isActive) return res.status(404).json({ error: 'Not found' });
      res.json(course);
    } catch (e) { next(e); }
  });

  return router;
}


