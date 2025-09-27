import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const prisma = new PrismaClient();

export function visitorsRouter() {
  const router = express.Router();

  // Track unique visitor
  router.post('/track', async (req, res, next) => {
    try {
      // Get real IP address from various headers (for reverse proxy setup)
      const ipAddress = req.headers['x-forwarded-for'] || 
                       req.headers['x-real-ip'] || 
                       req.connection.remoteAddress || 
                       req.socket.remoteAddress ||
                       req.ip ||
                       '127.0.0.1';
      
      // Handle comma-separated IPs (x-forwarded-for can contain multiple IPs)
      const realIp = ipAddress.split(',')[0].trim();
      
      const userAgent = req.get('User-Agent') || 'Unknown';
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of day

      console.log('Tracking visitor:', {
        ipAddress: realIp,
        userAgent: userAgent.substring(0, 100), // Truncate for logging
        date: today.toISOString(),
        headers: {
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'x-real-ip': req.headers['x-real-ip'],
          'x-client-ip': req.headers['x-client-ip']
        }
      });

      // Check if this IP already visited today
      const existingVisitor = await prisma.uniqueVisitor.findUnique({
        where: {
          ipAddress_date: {
            ipAddress: realIp,
            date: today
          }
        }
      });

      if (!existingVisitor) {
        // Create new visitor record
        await prisma.uniqueVisitor.create({
          data: {
            ipAddress: realIp,
            userAgent: userAgent,
            date: today
          }
        });
        
        console.log('New visitor tracked:', realIp);
        res.json({ 
          success: true, 
          message: 'Visitor tracked',
          isNewVisitor: true,
          ipAddress: realIp
        });
      } else {
        console.log('Visitor already tracked today:', realIp);
        res.json({ 
          success: true, 
          message: 'Visitor already tracked today',
          isNewVisitor: false,
          ipAddress: realIp
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
        analytics: completeData.map(day => ({
          date: day.date,
          count: day.visitors
        }))
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
        today: todayVisitors,
        thisWeek: weekVisitors,
        thisMonth: monthVisitors,
        allTime: allTimeVisitors
      });
    } catch (error) {
      console.error('Error getting visitor stats:', error);
      next(error);
    }
  });

  // Test endpoint to check visitor tracking (for debugging)
  router.get('/test', async (req, res, next) => {
    try {
      const ipAddress = req.headers['x-forwarded-for'] || 
                       req.headers['x-real-ip'] || 
                       req.connection.remoteAddress || 
                       req.socket.remoteAddress ||
                       req.ip ||
                       '127.0.0.1';
      
      const realIp = ipAddress.split(',')[0].trim();
      
      res.json({
        success: true,
        message: 'Test endpoint working',
        detectedIp: realIp,
        headers: {
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'x-real-ip': req.headers['x-real-ip'],
          'x-client-ip': req.headers['x-client-ip'],
          'user-agent': req.headers['user-agent']
        },
        reqIp: req.ip,
        connectionRemoteAddress: req.connection.remoteAddress,
        socketRemoteAddress: req.socket.remoteAddress
      });
    } catch (error) {
      console.error('Error in test endpoint:', error);
      next(error);
    }
  });

  return router;
}
