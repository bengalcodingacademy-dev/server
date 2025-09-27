import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const prisma = new PrismaClient();

export function visitorsRouter() {
  const router = express.Router();

  // Track unique visitor
  router.post('/track', async (req, res, next) => {
    try {
      const ipAddress = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      const userAgent = req.get('User-Agent');
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of day

      // Check if this IP already visited today
      const existingVisitor = await prisma.uniqueVisitor.findUnique({
        where: {
          ipAddress_date: {
            ipAddress: ipAddress,
            date: today
          }
        }
      });

      if (!existingVisitor) {
        // Create new visitor record
        await prisma.uniqueVisitor.create({
          data: {
            ipAddress: ipAddress,
            userAgent: userAgent,
            date: today
          }
        });
        
        res.json({ 
          success: true, 
          message: 'Visitor tracked',
          isNewVisitor: true 
        });
      } else {
        res.json({ 
          success: true, 
          message: 'Visitor already tracked today',
          isNewVisitor: false 
        });
      }
    } catch (error) {
      console.error('Error tracking visitor:', error);
      next(error);
    }
  });

  // Get visitor analytics (admin only)
  router.get('/analytics', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { year, month } = req.query;
      
      if (!year || !month) {
        return res.status(400).json({ 
          error: 'Year and month are required' 
        });
      }

      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0); // Last day of month

      // Get daily visitor counts for the month
      const dailyVisitors = await prisma.uniqueVisitor.groupBy({
        by: ['date'],
        where: {
          date: {
            gte: startDate,
            lte: endDate
          }
        },
        _count: {
          id: true
        },
        orderBy: {
          date: 'asc'
        }
      });

      // Format data for frontend
      const formattedData = dailyVisitors.map(day => ({
        date: day.date.toISOString().split('T')[0], // YYYY-MM-DD format
        visitors: day._count.id
      }));

      // Get total unique visitors for the month
      const totalVisitors = await prisma.uniqueVisitor.count({
        where: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      });

      // Get unique visitors by day for the entire month (including days with 0 visitors)
      const daysInMonth = endDate.getDate();
      const completeData = [];
      
      for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(parseInt(year), parseInt(month) - 1, day);
        const dateString = currentDate.toISOString().split('T')[0];
        
        const dayData = formattedData.find(d => d.date === dateString);
        completeData.push({
          date: dateString,
          visitors: dayData ? dayData.visitors : 0
        });
      }

      res.json({
        success: true,
        data: {
          monthly: {
            year: parseInt(year),
            month: parseInt(month),
            totalVisitors,
            dailyData: completeData
          }
        }
      });
    } catch (error) {
      console.error('Error getting visitor analytics:', error);
      next(error);
    }
  });

  // Get visitor statistics (admin only)
  router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const today = new Date();
      const startOfToday = new Date(today);
      startOfToday.setHours(0, 0, 0, 0);

      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

      // Today's visitors
      const todayVisitors = await prisma.uniqueVisitor.count({
        where: {
          date: {
            gte: startOfToday
          }
        }
      });

      // This week's visitors
      const weekVisitors = await prisma.uniqueVisitor.count({
        where: {
          date: {
            gte: startOfWeek
          }
        }
      });

      // This month's visitors
      const monthVisitors = await prisma.uniqueVisitor.count({
        where: {
          date: {
            gte: startOfMonth
          }
        }
      });

      // All time visitors
      const allTimeVisitors = await prisma.uniqueVisitor.count();

      res.json({
        success: true,
        data: {
          today: todayVisitors,
          week: weekVisitors,
          month: monthVisitors,
          allTime: allTimeVisitors
        }
      });
    } catch (error) {
      console.error('Error getting visitor stats:', error);
      next(error);
    }
  });

  return router;
}
