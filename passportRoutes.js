const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const ALL_CUISINES = [
  "North Indian", "South Indian", "Chinese", "Italian",
  "Thai", "Mexican", "Continental", "Fast Food",
  "Desserts", "Beverages", "Biryani", "Street Food"
];

// Milestone → offer definition (must match frontend MILESTONES)
const MILESTONE_OFFERS = [
  { count: 3,  badge: "Explorer",          type: "percent", discount: 10, minOrder: 0    },
  { count: 6,  badge: "Foodie",            type: "flat",    discount: 50, minOrder: 300  },
  { count: 12, badge: "Passport Complete", type: "flat",    discount: 100, minOrder: 0   },
];

function generateCouponCode(badge) {
  const prefix = badge.replace(/\s+/g, "").toUpperCase().slice(0, 6);
  return prefix + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// ─── GET MY FOOD PASSPORT ───────────────────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { foodPassport: 1, name: 1 } }
    );

    const passport = user.foodPassport || { explored: [], badges: [], couponUnlocked: false };
    const unexplored = ALL_CUISINES.filter(c => !passport.explored.includes(c));

    const nextBadge = MILESTONE_OFFERS.find(t => (passport.explored || []).length < t.count);

    res.json({
      explored: passport.explored || [],
      totalExplored: (passport.explored || []).length,
      totalCuisines: ALL_CUISINES.length,
      unexplored,
      badges: passport.badges || [],
      nextBadge: nextBadge ? { badge: nextBadge.badge, count: nextBadge.count } : null,
      progressToNextBadge: nextBadge
        ? `${(passport.explored || []).length}/${nextBadge.count}`
        : "All milestones unlocked!"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── GET MY COUPONS ─────────────────────────────────────────────────────────
router.get("/my-coupons", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const coupons = await db.collection("coupons")
      .find({ userId: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── CLAIM OFFER ────────────────────────────────────────────────────────────
// User taps "Claim offer" for a milestone they've reached.
// Creates a coupon document they can use at checkout.
router.post("/claim-offer", authMiddleware, async (req, res) => {
  try {
    const { badge } = req.body;
    const db = getDB();

    // Find milestone definition
    const milestone = MILESTONE_OFFERS.find(m => m.badge === badge);
    if (!milestone) return res.status(400).json({ message: "Unknown badge" });

    // Verify user has actually reached this milestone
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { foodPassport: 1 } }
    );
    const explored = user.foodPassport?.explored || [];
    if (explored.length < milestone.count) {
      return res.status(400).json({ message: "You haven't reached this milestone yet" });
    }

    // Check not already claimed (and not used)
    const existing = await db.collection("coupons").findOne({
      userId: new ObjectId(req.user.id),
      badge,
      used: false
    });
    if (existing) {
      return res.status(400).json({ message: "You already have an active coupon for this milestone", coupon: existing });
    }

    // Create coupon
    const code = generateCouponCode(badge);
    const coupon = {
      userId: new ObjectId(req.user.id),
      code,
      badge,
      type: milestone.type,         // "percent" or "flat"
      discount: milestone.discount,  // 10 (%) or 50/100 (₹)
      minOrder: milestone.minOrder,
      used: false,
      createdAt: new Date()
    };
    const result = await db.collection("coupons").insertOne(coupon);

    res.status(201).json({ message: "Coupon created", coupon: { ...coupon, _id: result.insertedId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── VALIDATE + APPLY COUPON (called at checkout) ───────────────────────────
// Returns the discount amount for a given coupon code + order total.
router.post("/apply-coupon", authMiddleware, async (req, res) => {
  try {
    const { code, orderTotal } = req.body;
    if (!code || !orderTotal) return res.status(400).json({ message: "code and orderTotal required" });

    const db = getDB();
    const coupon = await db.collection("coupons").findOne({
      userId: new ObjectId(req.user.id),
      code: code.toUpperCase(),
      used: false
    });

    if (!coupon) return res.status(404).json({ message: "Coupon not found or already used" });
    if (coupon.minOrder && orderTotal < coupon.minOrder) {
      return res.status(400).json({
        message: `Minimum order of ₹${coupon.minOrder} required for this coupon`,
        minOrder: coupon.minOrder
      });
    }

    const discountAmount = coupon.type === "percent"
      ? Math.round(orderTotal * coupon.discount / 100)
      : coupon.discount;

    const finalAmount = Math.max(0, orderTotal - discountAmount);

    res.json({
      valid: true,
      code: coupon.code,
      discountAmount,
      finalAmount,
      description: coupon.type === "percent"
        ? `${coupon.discount}% off (₹${discountAmount} saved)`
        : `₹${coupon.discount} off`
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── MARK COUPON AS USED (called inside orderRoutes after order placed) ──────
router.post("/use-coupon", authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    const db = getDB();
    await db.collection("coupons").updateOne(
      { userId: new ObjectId(req.user.id), code: code.toUpperCase(), used: false },
      { $set: { used: true, usedAt: new Date() } }
    );
    res.json({ message: "Coupon marked as used" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── GET ALL CUISINES LIST ───────────────────────────────────────────────────
router.get("/cuisines", async (req, res) => {
  res.json({ cuisines: ALL_CUISINES });
});

module.exports = router;