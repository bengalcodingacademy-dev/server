import Razorpay from "razorpay";
import crypto from "crypto";

// Initialize Razorpay instance only if keys are provided
// Updated: Added lazy initialization to prevent startup errors
let razorpay = null;

const getRazorpayInstance = () => {
  if (
    !razorpay &&
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET
  ) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
};

/**
 * Check if Razorpay is properly configured
 * @returns {boolean} - True if Razorpay is configured
 */
export const isRazorpayConfigured = () => {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
};

/**
 * Get Razorpay configuration status
 * @returns {Object} - Configuration status object
 */
export const getRazorpayStatus = () => {
  return {
    configured: isRazorpayConfigured(),
    hasKeyId: !!process.env.RAZORPAY_KEY_ID,
    hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
    instance: !!getRazorpayInstance(),
  };
};

/**
 * Create a Razorpay order
 * @param {Object} orderData - Order details
 * @param {number} orderData.amount - Amount in paise (smallest currency unit)
 * @param {string} orderData.currency - Currency code (default: INR)
 * @param {string} orderData.receipt - Receipt ID
 * @param {Object} orderData.notes - Additional notes
 * @returns {Promise<Object>} Razorpay order object
 */
export const createOrder = async (orderData) => {
  try {
    const razorpayInstance = getRazorpayInstance();
    if (!razorpayInstance) {
      console.log(
        "Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
      );

      throw new Error(
        "Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
      );
    }

    const options = {
      amount: orderData.amount, // Amount in paise
      currency: orderData.currency || "INR",
      receipt: orderData.receipt,
      notes: orderData.notes || {},
    };

    const order = await razorpayInstance.orders.create(options);
    return order;
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    throw new Error(`Failed to create order: ${error.message}`);
  }
};

/**
 * Verify Razorpay payment signature
 * @param {string} razorpayOrderId - Razorpay order ID
 * @param {string} razorpayPaymentId - Razorpay payment ID
 * @param {string} razorpaySignature - Razorpay signature
 * @returns {boolean} Whether the signature is valid
 */
export const verifyPayment = (
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      console.error("RAZORPAY_KEY_SECRET not configured");
      return false;
    }

    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    return expectedSignature === razorpaySignature;
  } catch (error) {
    console.error("Error verifying payment signature:", error);
    return false;
  }
};

/**
 * Fetch payment details from Razorpay
 * @param {string} paymentId - Razorpay payment ID
 * @returns {Promise<Object>} Payment details
 */
export const fetchPayment = async (paymentId) => {
  try {
    const razorpayInstance = getRazorpayInstance();
    if (!razorpayInstance) {
      throw new Error(
        "Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
      );
    }

    const payment = await razorpayInstance.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error("Error fetching payment:", error);
    throw new Error(`Failed to fetch payment: ${error.message}`);
  }
};

/**
 * Fetch order details from Razorpay
 * @param {string} orderId - Razorpay order ID
 * @returns {Promise<Object>} Order details
 */
export const fetchOrder = async (orderId) => {
  try {
    const razorpayInstance = getRazorpayInstance();
    if (!razorpayInstance) {
      throw new Error(
        "Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
      );
    }

    const order = await razorpayInstance.orders.fetch(orderId);
    return order;
  } catch (error) {
    console.error("Error fetching order:", error);
    throw new Error(`Failed to fetch order: ${error.message}`);
  }
};

export const sauvikRazorpay = async (orderData) => {
  console.log("sauvikRazorpay", orderData);
}

/**
 * Refund a payment
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amount - Amount to refund in paise (optional, defaults to full amount)
 * @param {string} notes - Refund notes
 * @returns {Promise<Object>} Refund details
 */
export const refundPayment = async (paymentId, amount = null, notes = "") => {
  try {
    const razorpayInstance = getRazorpayInstance();
    if (!razorpayInstance) {
      throw new Error(
        "Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
      );
    }

    const refundData = {
      payment_id: paymentId,
      notes: notes,
    };

    if (amount) {
      refundData.amount = amount;
    }

    const refund = await razorpayInstance.payments.refund(
      paymentId,
      refundData
    );
    return refund;
  } catch (error) {
    console.error("Error processing refund:", error);
    throw new Error(`Failed to process refund: ${error.message}`);
  }
};

export default getRazorpayInstance;
