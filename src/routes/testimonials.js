import express from 'express';

export function testimonialsRouter(prisma) {
  const router = express.Router();

  // Public route to get active testimonials
  router.get('/', async (req, res, next) => {
    try {
      const testimonials = await prisma.testimonial.findMany({ 
        where: { isActive: true },
        select: {
          id: true,
          studentName: true,
          studentImage: true,
          studentAbout: true,
          comment: true,
          rating: true,
          courseId: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20 // Limit results
      });
      
      // Set cache headers
      res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
      res.json(testimonials);
    } catch (e) { 
      next(e); 
    }
  });

  return router;
}
