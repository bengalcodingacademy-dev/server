import express from 'express';
import { z } from 'zod';

const createCourseSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  imageUrl: z.string().url().nullable().optional(),
  priceRupees: z.number().nonnegative(),
  shortDesc: z.string().min(2),
  longDesc: z.string().min(2),
  duration: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  syllabusJson: z.any().optional(),
  isActive: z.boolean().optional()
});

export function coursesRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const courses = await prisma.course.findMany({ 
        where: { isActive: true },
        select: {
          id: true,
          title: true,
          slug: true,
          imageUrl: true,
          priceRupees: true,
          shortDesc: true,
          longDesc: true,
          duration: true,
          startDate: true,
          endDate: true,
          isMonthlyPayment: true,
          durationMonths: true,
          monthlyFeeRupees: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // Limit results
      });
      
      // Set cache headers
      res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
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


