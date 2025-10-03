import express from "express";
import { createOrder, verifyPayment } from "../services/razorpay.js";
import { v4 as uuidv4 } from "uuid";

export default function purchasesRouter(prisma) {
  const router = express.Router();

// Verify payment
router.post("/verify-payment", async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

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

    // ✅ Update purchase in DB (mock here)
    const purchase = {
      id: razorpayOrderId, // in real app, fetch by your DB ID
      razorpayOrderId,
      razorpayPaymentId,
      status: "paid",
    };

    res.json({ success: true, purchase });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, error: error.message });
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
