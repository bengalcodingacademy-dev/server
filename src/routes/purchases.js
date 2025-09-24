import express from 'express';
import { z } from 'zod';
import { createOrder, verifyPayment, fetchPayment } from '../services/razorpay.js';

// Razorpay order creation schema
const razorpayOrderSchema = z.object({
  courseId: z.string().uuid(),
  isMonthlyPayment: z.boolean().optional(),
  monthNumber: z.number().int().positive().optional(),
  totalMonths: z.number().int().positive().optional()
});

// Razorpay payment verification schema
const razorpayVerifySchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string()
});

export function purchasesRouter(prisma) {
  const router = express.Router();


  // Create Razorpay order
  router.post('/create-order', async (req, res, next) => {
    try {
      const { courseId, isMonthlyPayment, monthNumber, totalMonths } = razorpayOrderSchema.parse(req.body);
      
      // Get course details
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course || !course.isActive) {
        return res.status(400).json({ error: 'Invalid course' });
      }

      // For one-time payments, check if user already has a paid purchase
      if (!isMonthlyPayment) {
        const existingPurchase = await prisma.purchase.findFirst({
          where: {
            userId: req.user.id,
            courseId,
            status: 'PAID',
            isMonthlyPayment: false
          }
        });

        if (existingPurchase) {
          return res.status(400).json({ error: 'You already have a purchase for this course' });
        }

        // Clean up any failed PENDING purchases for this course (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        await prisma.purchase.deleteMany({
          where: {
            userId: req.user.id,
            courseId,
            status: 'PENDING',
            isMonthlyPayment: false,
            createdAt: {
              lt: oneHourAgo
            }
          }
        });
      } else {
        // For monthly payments, check if user already has a paid payment for the same month
        const existingPaidPurchase = await prisma.purchase.findFirst({
          where: {
            userId: req.user.id,
            courseId,
            status: 'PAID',
            isMonthlyPayment: true,
            monthNumber: monthNumber
          }
        });

        if (existingPaidPurchase) {
          return res.status(400).json({ error: `You already have a payment for month ${monthNumber}` });
        }

        // Clean up any failed PENDING purchases for this month (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        await prisma.purchase.deleteMany({
          where: {
            userId: req.user.id,
            courseId,
            status: 'PENDING',
            isMonthlyPayment: true,
            monthNumber: monthNumber,
            createdAt: {
              lt: oneHourAgo
            }
          }
        });
      }

      // Calculate amount
      let amountRupees;
      if (isMonthlyPayment) {
        amountRupees = parseFloat(course.monthlyFeeRupees) || 0;
      } else {
        amountRupees = parseFloat(course.priceRupees) || 0;
      }

      if (amountRupees <= 0) {
        return res.status(400).json({ error: 'Invalid course price' });
      }

      // Create purchase record first
      const purchase = await prisma.purchase.create({
        data: {
          userId: req.user.id,
          courseId,
          amountRupees,
          status: 'PENDING',
          isMonthlyPayment: isMonthlyPayment || false,
          monthNumber,
          totalMonths
        }
      });

      // Create Razorpay order
      const orderData = {
        amount: Math.round(amountRupees * 100), // Convert rupees to paise for Razorpay
        currency: 'INR',
        receipt: `p_${purchase.id.slice(-8)}`,
        notes: {
          purchaseId: purchase.id,
          userId: req.user.id,
          courseId,
          courseTitle: course.title,
          isMonthlyPayment: isMonthlyPayment || false,
          monthNumber: monthNumber || null,
          totalMonths: totalMonths || null
        }
      };

      const razorpayOrder = await createOrder(orderData);

      // Update purchase with Razorpay order ID
      await prisma.purchase.update({
        where: { id: purchase.id },
        data: { razorpayOrderId: razorpayOrder.id }
      });

      res.json({
        order: razorpayOrder,
        purchase: {
          id: purchase.id,
          amountRupees: purchase.amountRupees,
          isMonthlyPayment: purchase.isMonthlyPayment,
          monthNumber: purchase.monthNumber,
          totalMonths: purchase.totalMonths
        }
      });
    } catch (e) { 
      console.error('Error creating Razorpay order:', e);
      next(e); 
    }
  });

  // Verify Razorpay payment
  router.post('/verify-payment', async (req, res, next) => {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = razorpayVerifySchema.parse(req.body);

      // Verify payment signature
      const isValidSignature = verifyPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      
      if (!isValidSignature) {
        return res.status(400).json({ error: 'Invalid payment signature' });
      }

      // Get purchase record
      const purchase = await prisma.purchase.findFirst({
        where: {
          razorpayOrderId,
          userId: req.user.id,
          status: 'PENDING'
        },
        include: {
          course: {
            select: {
              title: true,
              isMonthlyPayment: true
            }
          }
        }
      });

      if (!purchase) {
        return res.status(404).json({ error: 'Purchase not found' });
      }

      // Fetch payment details from Razorpay
      const paymentDetails = await fetchPayment(razorpayPaymentId);

      // Update purchase with payment details
      const updatedPurchase = await prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          status: 'PAID',
          razorpayPaymentId,
          razorpaySignature,
          updatedAt: new Date()
        },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true,
              shortDesc: true,
              isMonthlyPayment: true,
              durationMonths: true,
              monthlyFeeRupees: true,
              priceRupees: true
            }
          }
        }
      });

      res.json({
        success: true,
        purchase: updatedPurchase,
        paymentDetails: {
          id: paymentDetails.id,
          amount: paymentDetails.amount,
          currency: paymentDetails.currency,
          status: paymentDetails.status,
          method: paymentDetails.method
        }
      });
    } catch (e) { 
      console.error('Error verifying payment:', e);
      next(e); 
    }
  });


  router.get('/me', async (req, res, next) => {
    try {
      // Use the composite index for optimal performance
      const list = await prisma.purchase.findMany({
        where: { 
          userId: req.user.id 
        },
        include: { 
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true,
              shortDesc: true,
              isMonthlyPayment: true,
              durationMonths: true,
              monthlyFeeRupees: true,
              priceRupees: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        // Add a reasonable limit to prevent large result sets
        take: 100
      });
      
      // Temporarily disable caching to debug the issue
      // res.set('Cache-Control', 'private, max-age=60'); // Cache for 1 minute
      res.json(list);
    } catch (e) { next(e); }
  });

  return router;
}


