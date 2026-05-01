const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Initialize Razorpay instance
// Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// ─── CREATE RAZORPAY ORDER ───
// Frontend calls this first to get a Razorpay order ID before opening the checkout
router.post("/create-razorpay-order", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const razorpay = getRazorpay();

    const options = {
      amount: Math.round(amount * 100), // Razorpay expects paise (multiply by 100)
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId: req.user.id
      }
    };

    const order = await razorpay.orders.create(options);

    res.json({
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID  // sent to frontend for checkout init
    });

  } catch (error) {
    console.error("Razorpay order creation error:", error);
    if (error.message?.includes("not configured")) {
      return res.status(500).json({ message: error.message });
    }
    res.status(500).json({ message: "Failed to create payment order" });
  }
});

// ─── VERIFY RAZORPAY PAYMENT (standalone verification endpoint) ───
// Used if you want to verify without placing an order (e.g. wallet top-up)
router.post("/verify-razorpay", authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    res.json({ verified: true, message: "Payment verified successfully" });

  } catch (error) {
    console.error("Razorpay verification error:", error);
    res.status(500).json({ message: "Payment verification failed" });
  }
});

module.exports = router;