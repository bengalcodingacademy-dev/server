import express from 'express';
import { requireAuth } from '../middleware/auth.js';

export function announcementsRouter(prisma) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const list = await prisma.announcement.findMany({ 
        select: {
          id: true,
          title: true,
          body: true,
          courseId: true,
          createdAt: true,
          course: { 
            select: { 
              title: true, 
              slug: true 
            } 
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // Limit results
      });
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=60'); // Cache for 1 minute
      res.json(list);
    } catch (e) { next(e); }
  });

  // Get user-specific announcements with read status
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      // First get user's purchased course IDs
      const userPurchases = await prisma.purchase.findMany({
        where: { userId: req.user.id, status: 'PAID' },
        select: { courseId: true }
      });
      
      const purchasedCourseIds = userPurchases.map(p => p.courseId);
      
      // Get announcements that are either global or for purchased courses
      const announcements = await prisma.announcement.findMany({
        where: {
          OR: [
            { courseId: null }, // Global announcements
            { courseId: { in: purchasedCourseIds } } // Course-specific announcements
          ]
        },
        select: {
          id: true,
          title: true,
          body: true,
          courseId: true,
          createdAt: true,
          course: { 
            select: { 
              title: true, 
              slug: true 
            } 
          },
          receipts: {
            where: { userId: req.user.id },
            select: { isRead: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // Limit results
      });

      // Add read status to each announcement
      const announcementsWithReadStatus = announcements.map(ann => ({
        ...ann,
        isRead: ann.receipts.length > 0 ? ann.receipts[0].isRead : true, // If no receipt, consider it read (global announcement)
        receipts: undefined // Remove receipts from response
      }));

      // Set cache headers
      res.set('Cache-Control', 'private, max-age=30'); // Cache for 30 seconds
      res.json(announcementsWithReadStatus);
    } catch (e) { next(e); }
  });

  // Get unread count for user
  router.get('/me/unread-count', requireAuth, async (req, res, next) => {
    try {
      const count = await prisma.notificationReceipt.count({
        where: { 
          userId: req.user.id, 
          isRead: false 
        }
      });
      
      // Disable caching to ensure fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json({ count });
    } catch (e) { next(e); }
  });

  // Mark announcements as read
  router.post('/me/read', requireAuth, async (req, res, next) => {
    try {
      const receipts = await prisma.notificationReceipt.updateMany({
        where: { userId: req.user.id, isRead: false },
        data: { isRead: true }
      });
      res.json({ updated: receipts.count });
    } catch (e) { next(e); }
  });

  // Mark specific announcement as read
  router.post('/me/read/:announcementId', requireAuth, async (req, res, next) => {
    try {
      const receipt = await prisma.notificationReceipt.updateMany({
        where: { 
          userId: req.user.id, 
          announcementId: req.params.announcementId,
          isRead: false 
        },
        data: { isRead: true }
      });
      res.json({ updated: receipt.count });
    } catch (e) { next(e); }
  });

  return router;
}


