import express from 'express';
import { requireAuth } from '../middleware/auth.js';

export function announcementsRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const list = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
      res.json(list);
    } catch (e) { next(e); }
  });

  // optional: user receipts
  router.post('/me/read', requireAuth, async (req, res, next) => {
    try {
      const receipts = await prisma.notificationReceipt.updateMany({
        where: { userId: req.user.id, isRead: false },
        data: { isRead: true }
      });
      res.json({ updated: receipts.count });
    } catch (e) { next(e); }
  });

  return router;
}


