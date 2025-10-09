import express from 'express';
import { z } from 'zod';

export function purchaseNotificationsRouter(prisma) {
  const router = express.Router();

  // Get purchase notifications for admin
  router.get('/', async (req, res, next) => {
    try {
      const { filter = 'all' } = req.query;
      
      // Calculate date range based on filter
      let dateFilter = {};
      const now = new Date();
      
      switch (filter) {
        case 'today':
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          dateFilter = { createdAt: { gte: today } };
          break;
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = { createdAt: { gte: weekAgo } };
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = { createdAt: { gte: monthAgo } };
          break;
        default:
          // All time - no date filter
          break;
      }

      // Get purchase notifications
      const notifications = await prisma.purchaseNotification.findMany({
        where: dateFilter,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          course: {
            select: {
              id: true,
              title: true,
              slug: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      // Get unread count
      const unreadCount = await prisma.purchaseNotification.count({
        where: { isRead: false }
      });

      // Format notifications
      const formattedNotifications = notifications.map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        amount: notification.amount,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
        userName: notification.user.name,
        userEmail: notification.user.email,
        courseTitle: notification.course.title,
        courseSlug: notification.course.slug
      }));

      res.json({
        notifications: formattedNotifications,
        unreadCount
      });
    } catch (e) {
      next(e);
    }
  });

  // Mark notification as read
  router.patch('/:id/read', async (req, res, next) => {
    try {
      const { id } = req.params;
      
      await prisma.purchaseNotification.update({
        where: { id },
        data: { isRead: true }
      });

      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  // Mark all notifications as read
  router.patch('/mark-all-read', async (req, res, next) => {
    try {
      await prisma.purchaseNotification.updateMany({
        where: { isRead: false },
        data: { isRead: true }
      });

      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  // Get notification statistics
  router.get('/stats', async (req, res, next) => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
        prisma.purchaseNotification.count({
          where: { createdAt: { gte: today } }
        }),
        prisma.purchaseNotification.count({
          where: { createdAt: { gte: weekAgo } }
        }),
        prisma.purchaseNotification.count({
          where: { createdAt: { gte: monthAgo } }
        }),
        prisma.purchaseNotification.count()
      ]);

      res.json({
        today: todayCount,
        week: weekCount,
        month: monthCount,
        total: totalCount
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

// Helper function to create purchase notification
export async function createPurchaseNotification(prisma, data) {
  try {
    const notification = await prisma.purchaseNotification.create({
      data: {
        type: data.type, // 'PURCHASE', 'MONTHLY_PAYMENT', 'MANUAL_ACCESS'
        title: data.title,
        message: data.message,
        amount: data.amount,
        userId: data.userId,
        courseId: data.courseId,
        purchaseId: data.purchaseId,
        isRead: false
      }
    });

    console.log(`📢 Purchase notification created: ${data.title} for ${data.userEmail}`);
    return notification;
  } catch (error) {
    console.error('Error creating purchase notification:', error);
    return null;
  }
}
