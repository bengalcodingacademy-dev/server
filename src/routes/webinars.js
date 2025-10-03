import express from 'express';

export function webinarsRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      // First, clean up past webinars (older than 1 day) - do this less frequently
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.webinar.deleteMany({
        where: {
          startTime: {
            lt: oneDayAgo
          }
        }
      });

      // Get upcoming webinars only
      const items = await prisma.webinar.findMany({ 
        where: {
          startTime: {
            gte: new Date()
          }
        },
        select: {
          id: true,
          title: true,
          description: true,
          presenter: true,
          startTime: true,
          joinLink: true,
          imageUrl: true
        },
        orderBy: { startTime: 'asc' },
        take: 20 // Limit results
      });
      
      // Replace S3 URLs with CloudFront URLs
      const itemsWithCloudFront = items.map(item => ({
        ...item,
        imageUrl: item.imageUrl 
          ? item.imageUrl.replace(
              'https://sauvikbcabucket.s3.ap-south-1.amazonaws.com',
              'https://d270a3f3iqnh9i.cloudfront.net'
            )
          : item.imageUrl
      }));
      
      // Set cache headers
      res.set('Cache-Control', 'public, max-age=60'); // Cache for 1 minute
      res.json(itemsWithCloudFront);
    } catch (e) { next(e); }
  });

  return router;
}


