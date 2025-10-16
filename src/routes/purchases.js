import express from "express";
import { z } from "zod";
import { createOrder, verifyPayment } from "../services/razorpay.js";
import { v4 as uuidv4 } from "uuid";
import { createPurchaseNotification } from "./purchaseNotifications.js";

export default function purchasesRouter(prisma) {
  const router = express.Router();

  // Get user's purchases (both regular and monthly)
  router.get('/me', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get regular purchases
      const purchases = await prisma.purchase.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Get monthly purchases
      const monthlyPurchases = await prisma.monthlyPurchase.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Combine both types of purchases
      const allPurchases = [
        ...purchases.map(p => ({ ...p, type: 'regular' })),
        ...monthlyPurchases.map(p => ({ ...p, type: 'monthly' }))
      ];

      res.json(allPurchases);
    } catch (error) {
      console.error('Error fetching user purchases:', error);
      res.status(500).json({ error: 'Failed to fetch purchases' });
    }
  });

// Verify payment
router.post("/verify-payment", async (req, res) => {
  try {
    // Validate body to avoid Prisma receiving undefined/invalid values
    const bodySchema = z.object({
      razorpayOrderId: z.string().min(1),
      razorpayPaymentId: z.string().min(1),
      razorpaySignature: z.string().min(1),
      courseId: z.string().min(1),
      isMonthlyPayment: z.boolean().optional(),
      monthNumber: z.number().int().positive().optional(),
      totalMonths: z.number().int().positive().optional()
    });

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, courseId, isMonthlyPayment, monthNumber, totalMonths } = bodySchema.parse(req.body);

    const isValid = verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (!isValid) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid signature" });
    }

    // Get user ID from the authenticated request
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }

    // Fetch course details
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        priceRupees: true,
        monthlyFeeRupees: true,
        isMonthlyPayment: true
      }
    });

    if (!course) {
      return res.status(404).json({ success: false, error: "Course not found" });
    }

    // Calculate amount
    let amountRupees;
    if (isMonthlyPayment && course.isMonthlyPayment) {
      amountRupees = parseFloat(course.monthlyFeeRupees) || 0;
    } else {
      amountRupees = parseFloat(course.priceRupees) || 0;
    }

    // Create purchase record in database
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        courseId,
        amountRupees: String(amountRupees),
        status: "PAID",
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        isMonthlyPayment: isMonthlyPayment || false,
        monthNumber: monthNumber || null,
        totalMonths: totalMonths || null
      }
    });

    // Update user's interest status to PURCHASED
    await prisma.user.update({
      where: { id: userId },
      data: { interestStatus: 'PURCHASED' }
    });

    // Create purchase notification for admin
    await createPurchaseNotification(prisma, {
      type: isMonthlyPayment ? 'MONTHLY_PAYMENT' : 'PURCHASE',
      title: isMonthlyPayment 
        ? `Monthly Payment Received - Month ${monthNumber}` 
        : 'New Course Purchase',
      message: isMonthlyPayment
        ? `User paid ₹${amountRupees} for month ${monthNumber} of "${course.title}"`
        : `User purchased "${course.title}" for ₹${amountRupees}`,
      amount: amountRupees,
      userId: userId,
      courseId: courseId,
      purchaseId: purchase.id,
      userEmail: req.user.email
    });

    // If it's a monthly payment, also create a MonthlyPurchase record
    if (isMonthlyPayment && monthNumber) {
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + 1); // Next month

      await prisma.monthlyPurchase.create({
        data: {
          userId,
          courseId,
          monthNumber,
          amountRupees: String(amountRupees),
          status: "PAID",
          dueDate,
          paidAt: new Date()
        }
      });
    }

    res.json({ success: true, purchase });
  } catch (error) {
    // Send safe error to client; log detailed error on server
    console.error("Error verifying payment:", error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: 'Invalid payment payload' });
    }
    return res.status(500).json({ success: false, error: 'Internal server error during payment verification' });
  }
});

// Create order
router.post("/create-order", async (req, res) => {
  try {
    const { courseId, isMonthlyPayment, monthNumber, totalMonths } = req.body;

    // Fetch course details from database
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        priceRupees: true,
        monthlyFeeRupees: true,
        isMonthlyPayment: true
      }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Calculate amount based on course pricing
    let amountRupees;
    if (isMonthlyPayment && course.isMonthlyPayment) {
      amountRupees = parseFloat(course.monthlyFeeRupees) || 0;
      console.log('💰 Monthly payment calculation:', {
        courseId,
        monthlyFeeRupees: course.monthlyFeeRupees,
        parsedAmount: amountRupees,
        isMonthlyPayment,
        courseIsMonthlyPayment: course.isMonthlyPayment
      });
    } else {
      amountRupees = parseFloat(course.priceRupees) || 0;
      console.log('💰 Full payment calculation:', {
        courseId,
        priceRupees: course.priceRupees,
        parsedAmount: amountRupees,
        isMonthlyPayment,
        courseIsMonthlyPayment: course.isMonthlyPayment
      });
    }

    if (amountRupees <= 0) {
      return res.status(400).json({ error: 'Invalid course pricing' });
    }

    const amountPaise = Math.round(amountRupees * 100);
    
    console.log('💳 Final payment amount:', {
      amountRupees,
      amountPaise,
      isMonthlyPayment,
      monthNumber
    });

    const receipt = `p_${uuidv4().slice(0, 8)}`;

    // Create Razorpay order
    const order = await createOrder({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes: {
        courseId,
        isMonthlyPayment,
        monthNumber,
        totalMonths,
      },
    });

    // Mock purchase entry
    const purchase = {
      id: uuidv4(),
      courseId,
      isMonthlyPayment,
      monthNumber,
      totalMonths,
      amountRupees: String(amountRupees),
      status: "pending",
    };

    res.json({ order, purchase });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: error.message });
  }
});

  return router;
}
