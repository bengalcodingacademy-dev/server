import express from 'express';
import { z } from 'zod';

export function dmlRouter(prisma) {
  const router = express.Router();

  // Middleware to ensure only admins can access DML operations
  const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // Grant Course Access
  router.post('/grant-access', requireAdmin, async (req, res, next) => {
    try {
      const schema = z.object({
        userEmail: z.string().email(),
        courseId: z.string().uuid(),
        accessType: z.enum(['full', 'monthly']),
        monthNumber: z.number().int().min(1).max(12).optional(),
        amountPaid: z.string().optional(),
        paymentMethod: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'other']).optional(),
        notes: z.string().optional()
      });

      const { userEmail, courseId, accessType, monthNumber, amountPaid, paymentMethod, notes } = schema.parse(req.body);

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: userEmail }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Find course by ID
      const course = await prisma.course.findUnique({
        where: { id: courseId }
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      let result;

      if (accessType === 'full') {
        // Check if user already has full access to this course
        const existingPurchase = await prisma.purchase.findFirst({
          where: {
            userId: user.id,
            courseId: courseId,
            isMonthlyPayment: false
          }
        });

        if (existingPurchase) {
          return res.status(400).json({ error: 'User already has full access to this course' });
        }

        // Create full course purchase record
        const purchase = await prisma.purchase.create({
          data: {
            userId: user.id,
            courseId: courseId,
            amountRupees: amountPaid ? parseFloat(amountPaid) : course.priceRupees,
            paymentMethod: paymentMethod || 'cash',
            status: 'PAID',
            isMonthlyPayment: false,
            razorpayOrderId: `manual_${Date.now()}`,
            razorpayPaymentId: `manual_payment_${Date.now()}`,
            razorpaySignature: 'manual_signature',
            createdAt: new Date()
          }
        });

        result = {
          type: 'full',
          id: purchase.id,
          userEmail: user.email,
          courseTitle: course.title,
          amountPaid: purchase.amountRupees,
          paymentMethod: purchase.paymentMethod
        };

        console.log(`DML: Full course access granted to ${userEmail} for course ${courseId} by admin ${req.user.email}`);

      } else if (accessType === 'monthly') {
        // Validate month number for monthly access
        if (!monthNumber) {
          return res.status(400).json({ error: 'Month number is required for monthly access' });
        }

        // Check if user already has access to this specific month
        const existingMonthlyPurchase = await prisma.monthlyPurchase.findFirst({
          where: {
            userId: user.id,
            courseId: courseId,
            monthNumber: monthNumber
          }
        });

        if (existingMonthlyPurchase) {
          return res.status(400).json({ error: `User already has access to month ${monthNumber} of this course` });
        }

        // Calculate due date (30 days from now)
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);

        // Create monthly purchase record
        const monthlyPurchase = await prisma.monthlyPurchase.create({
          data: {
            userId: user.id,
            courseId: courseId,
            monthNumber: monthNumber,
            amountRupees: amountPaid ? parseFloat(amountPaid) : (course.monthlyFeeRupees || course.priceRupees),
            status: 'PAID',
            dueDate: dueDate,
            paidAt: new Date(),
            createdAt: new Date()
          }
        });

        result = {
          type: 'monthly',
          id: monthlyPurchase.id,
          userEmail: user.email,
          courseTitle: course.title,
          monthNumber: monthNumber,
          amountPaid: monthlyPurchase.amountRupees,
          dueDate: monthlyPurchase.dueDate
        };

        console.log(`DML: Monthly access granted to ${userEmail} for course ${courseId}, month ${monthNumber} by admin ${req.user.email}`);
      }

      res.json({
        success: true,
        message: `${accessType === 'full' ? 'Full course' : `Month ${monthNumber}`} access granted successfully`,
        purchase: result
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      next(error);
    }
  });

  // User Management
  router.post('/user-management', requireAdmin, async (req, res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        action: z.enum(['activate', 'deactivate', 'delete'])
      });

      const { email, action } = schema.parse(req.body);

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      let result;

      switch (action) {
        case 'activate':
          result = await prisma.user.update({
            where: { id: user.id },
            data: { 
              status: 'ACTIVE',
              updatedAt: new Date()
            }
          });
          break;

        case 'deactivate':
          result = await prisma.user.update({
            where: { id: user.id },
            data: { 
              status: 'INACTIVE',
              updatedAt: new Date()
            }
          });
          break;

        case 'delete':
          // Check if user has purchases
          const purchases = await prisma.purchase.findMany({
            where: { userId: user.id }
          });

          if (purchases.length > 0) {
            return res.status(400).json({ 
              error: 'Cannot delete user with existing purchases. Deactivate instead.' 
            });
          }

          result = await prisma.user.delete({
            where: { id: user.id }
          });
          break;

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }

      // Log the DML operation
      console.log(`DML: User ${action} performed on ${email} by admin ${req.user.email}`);

      res.json({
        success: true,
        message: `User ${action}d successfully`,
        user: {
          id: result.id,
          email: result.email,
          status: result.status || 'DELETED'
        }
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      next(error);
    }
  });


  // Get Course List with UUIDs (for DML operations)
  router.get('/courses', requireAdmin, async (req, res, next) => {
    try {
      const courses = await prisma.course.findMany({
        select: {
          id: true,
          title: true,
          priceRupees: true,
          isActive: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        courses: courses.map(course => ({
          id: course.id,
          title: course.title,
          price: course.priceRupees,
          isActive: course.isActive,
          created: course.createdAt
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  // Get DML Logs (for audit purposes)
  // Update User Interest Status
  router.post('/update-interest-status', requireAdmin, async (req, res, next) => {
    try {
      const schema = z.object({
        userEmail: z.string().email(),
        interestStatus: z.enum(['INTERESTED', 'NOT_INTERESTED', 'PURCHASED'])
      });

      const { userEmail, interestStatus } = schema.parse(req.body);

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: userEmail }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update user's interest status
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { interestStatus },
        select: {
          id: true,
          email: true,
          name: true,
          interestStatus: true,
          createdAt: true
        }
      });

      // Log the DML operation
      console.log(`DML: Interest status updated to ${interestStatus} for ${userEmail} by admin ${req.user.email}`);

      res.json({
        success: true,
        message: `User interest status updated to ${interestStatus}`,
        user: updatedUser
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      next(error);
    }
  });

  router.get('/logs', requireAdmin, async (req, res, next) => {
    try {
      // This would typically come from a separate logs table
      // For now, we'll return a placeholder
      res.json({
        message: 'DML logs would be available here',
        note: 'Implement proper logging system for production'
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
