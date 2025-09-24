import express from "express";
import axios from "axios";

const router = express.Router();

// Get client ID from environment variable
const CLIENT_ID = process.env.PHONE_EMAIL_CLIENT_ID;

// Verify phone number from phone.email widget callback
router.post("/verify-phone-email", async (req, res) => {
  try {
    const { user_json_url } = req.body;

    console.log("Phone.email verification request:", { user_json_url });

    if (!user_json_url) {
      return res.status(400).json({ error: "user_json_url is required" });
    }

    // Fetch user data from phone.email callback URL
    const response = await axios.get(user_json_url);
    const userData = response.data;

    console.log("Phone.email user data:", userData);

    // Extract phone number and other data
    const phoneNumber = userData.user_phone_number;
    const countryCode = userData.user_country_code;
    const firstName = userData.user_first_name;
    const lastName = userData.user_last_name;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number not found in verification data" });
    }

    // Return verified phone data
    res.json({
      success: true,
      phone: phoneNumber,
      countryCode,
      firstName,
      lastName,
      message: "Phone number verified successfully"
    });
  } catch (error) {
    console.error("Phone.email verification error:", error);
    res.status(500).json({ 
      error: error.message || "Failed to verify phone number",
      details: error.response?.data
    });
  }
});

// Development fallback endpoint (keep for testing)
router.post("/send-otp", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    console.log("Development OTP request:", { phoneNumber });

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Development fallback - return success without actually sending OTP
    return res.json({ 
      success: true, 
      message: "OTP sent successfully (development mode)",
      otp: "123456" // For development testing
    });
  } catch (error) {
    console.error("Development OTP error:", error);
    res.status(500).json({ 
      error: error.message || "Failed to send OTP"
    });
  }
});

// Development fallback verification endpoint
router.post("/verify-otp", async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: "Phone number and OTP are required" });
    }

    // Development fallback - accept "123456" as valid OTP
    if (otp === "123456") {
      return res.json({ 
        success: true, 
        message: "OTP verified successfully (development mode)" 
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid OTP (development mode - use 123456)" 
      });
    }
  } catch (error) {
    console.error("Development verify OTP error:", error);
    res.status(500).json({ 
      error: error.message || "Failed to verify OTP" 
    });
  }
});

export default router;
