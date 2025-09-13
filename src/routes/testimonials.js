import express from 'express';

export function testimonialsRouter(prisma) {
  const router = express.Router();

  // Public route to get active testimonials
  router.get('/', async (req, res, next) => {
    try {
      const testimonials = await prisma.testimonial.findMany({ 
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(testimonials);
    } catch (e) { 
      next(e); 
    }
  });

  return router;
}
