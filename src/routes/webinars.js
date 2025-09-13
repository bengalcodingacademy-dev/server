import express from 'express';

export function webinarsRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const items = await prisma.webinar.findMany({ orderBy: { startTime: 'asc' } });
      res.json(items);
    } catch (e) { next(e); }
  });

  return router;
}


