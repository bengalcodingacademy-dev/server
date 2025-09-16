import express from 'express';

export function webinarsRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      // First, clean up past webinars (older than 1 day)
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
        orderBy: { startTime: 'asc' } 
      });
      res.json(items);
    } catch (e) { next(e); }
  });

  return router;
}


