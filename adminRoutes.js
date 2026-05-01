const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Access denied. Admins only." });
  next();
};

// ─── DASHBOARD STATS ───
router.get("/stats", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const totalUsers  = await db.collection("users").countDocuments();
    const totalOrders = await db.collection("orders").countDocuments();
    const payments    = await db.collection("payments").find({}).toArray();
    const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    res.json({ totalUsers, totalOrders, totalRevenue });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── ALL ORDERS (enriched with restaurant name and delivery info) ───
router.get("/orders", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection("orders").find({}).sort({ createdAt: -1 }).toArray();

    const restaurantIds = [...new Set(orders.map(o => o.restaurant_id?.toString()).filter(Boolean))];
    const restaurants = await db.collection("restaurants")
      .find({ _id: { $in: restaurantIds.map(id => new ObjectId(id)) } })
      .toArray();
    const restaurantMap = {};
    restaurants.forEach(r => { restaurantMap[r._id.toString()] = r.name; });

    const deliveries = await db.collection("deliveries").find({}).toArray();
    const deliveryMap = {};
    deliveries.forEach(d => { deliveryMap[d.order_id.toString()] = d; });

    const enriched = orders.map(o => ({
      ...o,
      restaurantName: restaurantMap[o.restaurant_id?.toString()] || null,
      delivery: deliveryMap[o._id.toString()] || null
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── SCHEDULED ORDERS (enriched) ───
router.get("/scheduled-orders", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection("orders")
      .find({ orderType: "scheduled", order_status: "Scheduled" })
      .sort({ scheduledFor: 1 })
      .toArray();

    const restaurantIds = [...new Set(orders.map(o => o.restaurant_id?.toString()).filter(Boolean))];
    const restaurants = await db.collection("restaurants")
      .find({ _id: { $in: restaurantIds.map(id => new ObjectId(id)) } })
      .toArray();
    const restaurantMap = {};
    restaurants.forEach(r => { restaurantMap[r._id.toString()] = r.name; });

    res.json(orders.map(o => ({
      ...o,
      restaurantName: restaurantMap[o.restaurant_id?.toString()] || null
    })));
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── UPDATE ORDER STATUS ───
router.put("/orders/status/:orderId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const db = getDB();

    await db.collection("orders").updateOne(
      { _id: new ObjectId(req.params.orderId) },
      { $set: { order_status: status } }
    );

    // ── On Delivered: record actual delivery time + free the partner ──
    if (status === "Delivered") {
      const deliveryDoc = await db.collection("deliveries").findOne({
        order_id: new ObjectId(req.params.orderId)
      });

      if (deliveryDoc) {
        const createdAt    = deliveryDoc.createdAt;
        const deliveryMins = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000);

        await db.collection("deliveries").updateOne(
          { order_id: new ObjectId(req.params.orderId) },
          { $set: { delivery_status: "Delivered", delivery_time_mins: deliveryMins, deliveredAt: new Date() } }
        );

        // Free the partner using the stored delivery_partner_id
        if (deliveryDoc.delivery_partner_id) {
          await db.collection("deliverypartners").updateOne(
            { _id: deliveryDoc.delivery_partner_id },
            { $set: { available: true }, $unset: { currentOrderId: "" } }
          );
        }
      }
    }

    // ── On Cancelled: free the partner too ──
    if (status === "Cancelled") {
      const deliveryDoc = await db.collection("deliveries").findOne({
        order_id: new ObjectId(req.params.orderId)
      });

      if (deliveryDoc) {
        await db.collection("deliveries").updateOne(
          { order_id: new ObjectId(req.params.orderId) },
          { $set: { delivery_status: "Cancelled" } }
        );

        if (deliveryDoc.delivery_partner_id) {
          await db.collection("deliverypartners").updateOne(
            { _id: deliveryDoc.delivery_partner_id },
            { $set: { available: true }, $unset: { currentOrderId: "" } }
          );
        }
      }
    }

    res.json({ message: "Status updated" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── ALL PAYMENTS ───
router.get("/payments", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const payments = await db.collection("payments").find({}).toArray();
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── ALL DELIVERIES ───
router.get("/deliveries", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const deliveries = await db.collection("deliveries").find({}).toArray();
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── RESET ALL PARTNERS TO AVAILABLE ───
// Utility endpoint: call once if partners got stuck as unavailable from old orders
router.post("/reset-partners", authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection("deliverypartners").updateMany(
      {},
      { $set: { available: true }, $unset: { currentOrderId: "" } }
    );
    res.json({ message: `Reset ${result.modifiedCount} delivery partners to available.` });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;