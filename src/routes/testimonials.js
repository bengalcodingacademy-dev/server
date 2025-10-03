import express from 'express';

export function testimonialsRouter(prisma) {
  const router = express.Router();

  // Public route to get all testimonials
  router.get('/', async (req, res, next) => {
    try {
      const testimonials = await prisma.testimonial.findMany({ 
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
      
      // Replace S3 URLs with CloudFront URLs
      const testimonialsWithCloudFront = testimonials.map(testimonial => ({
        ...testimonial,
        studentImage: testimonial.studentImage 
          ? testimonial.studentImage.replace(
              'https://sauvikbcabucket.s3.ap-south-1.amazonaws.com',
              'https://d270a3f3iqnh9i.cloudfront.net'
            )
          : testimonial.studentImage
      }));
      
      // Set cache headers
      res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
      res.json(testimonialsWithCloudFront);
    } catch (e) { 
      next(e); 
    }
  });

  return router;
}
