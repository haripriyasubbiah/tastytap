require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const { connectDB, getDB } = require("./db");
const { ObjectId } = require("mongodb");

const authRoutes           = require("./routes/authRoutes");
const restaurantRoutes     = require("./routes/restaurantRoutes");
const menuRoutes           = require("./routes/menuRoutes");
const paymentRoutes        = require("./routes/paymentRoutes");
const orderRoutes          = require("./routes/orderRoutes");
const adminRoutes          = require("./routes/adminRoutes");
const groupOrderRoutes     = require("./routes/groupOrderRoutes");
const recommendationRoutes = require("./routes/recommendationRoutes");
const trendingRoutes       = require("./routes/trendingRoutes");
const userRoutes           = require("./routes/userRoutes");
const passportRoutes       = require("./routes/passportRoutes");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth",            authRoutes);
app.use("/api/restaurants",     restaurantRoutes);
app.use("/api/menu",            menuRoutes);
app.use("/api/orders",          orderRoutes);
app.use("/api/admin",           adminRoutes);
app.use("/api/grouporders",     groupOrderRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/trending",        trendingRoutes);
app.use("/api/users",           userRoutes);
app.use("/api/passport",        passportRoutes);
app.use("/api/payments",        paymentRoutes);

app.get("/", (req, res) => {
  res.send("Food Ordering Backend Running ✅");
});

// ─── CRON: Trigger scheduled orders 10 mins before scheduledFor ───
//
// FIX 3 (from orderRoutes): The original cron did NOT save delivery_partner_id
// or currentOrderId, so the admin panel could never free the partner when
// marking the order Delivered / Cancelled.
//
// Also fixed: uses findOneAndUpdate (atomic) to claim the partner, matching
// the same race-condition fix applied in orderRoutes.assignDeliveryPartner().
// Uses serviceArea field (matches deliveryPartnerSeed.js) instead of area.
//
cron.schedule("* * * * *", async () => {
  try {
    const db = getDB();
    const now = new Date();
    const tenMinsLater = new Date(now.getTime() + 10 * 60 * 1000);

    const scheduledOrders = await db.collection("orders").find({
      orderType:    "scheduled",
      order_status: "Scheduled",
      scheduledFor: { $lte: tenMinsLater }
    }).toArray();

    for (const order of scheduledOrders) {

      // Atomically claim a partner — prevents double-assignment across
      // concurrent cron ticks if the server somehow runs slow.
      const partner = await db.collection("deliverypartners").findOneAndUpdate(
        { available: true },
        { $set: { available: false, currentOrderId: order._id } },
        { returnDocument: "after" }
      );

      if (!partner) {
        console.warn(`[CRON] No partner available for scheduled order ${order._id} — will retry next tick`);
        continue;
      }

      // FIX 3: save delivery_partner_id so adminRoutes can free the partner
      await db.collection("deliveries").insertOne({
        order_id:            order._id,
        delivery_address:    order.delivery_address,
        delivery_area:       order.delivery_area || "Unknown",
        delivery_status:     "Assigned",
        delivery_person:     partner.name,
        delivery_partner_id: partner._id,        // ← was missing before
        estimated_time:      "45 mins",
        delivery_time_mins:  null,
        "Customer Rating-Delivery": null,
        createdAt:           new Date()
      });

      await db.collection("orders").updateOne(
        { _id: order._id },
        { $set: { order_status: "Confirmed" } }
      );

      console.log(`✅ [CRON] Scheduled order ${order._id} triggered → assigned to ${partner.name}`);
    }
  } catch (err) {
    console.error("CRON SCHEDULED ORDER ERROR:", err);
  }
});

// ─── CRON: Close reorder windows after 10 mins ───
//
// This cron is now a safety net only. The primary close happens immediately
// inside orderRoutes POST /add-items (FIX 5). This cron catches any windows
// that were opened but where the user never actually added items.
//
cron.schedule("* * * * *", async () => {
  try {
    const db = getDB();
    const now = new Date();

    const result = await db.collection("orders").updateMany(
      {
        order_status:           "pending_additions",
        reorderWindowExpiresAt: { $lte: now }
      },
      { $set: { order_status: "Confirmed" } }
    );

    if (result.modifiedCount > 0) {
      console.log(`[CRON] Closed ${result.modifiedCount} expired reorder window(s)`);
    }
  } catch (err) {
    console.error("CRON REORDER WINDOW ERROR:", err);
  }
});

// ─── CRON: Refresh neighbourhood trending cache every 15 mins ───
cron.schedule("*/15 * * * *", async () => {
  try {
    const db = getDB();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { createdAt: { $gte: twoHoursAgo } } },
      {
        $group: {
          _id:   { area: "$delivery_area", restaurant_id: "$restaurant_id" },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ];

    const results = await db.collection("orders").aggregate(pipeline).toArray();

    await db.collection("trendingcache").deleteMany({});
    if (results.length > 0) {
      await db.collection("trendingcache").insertMany(
        results.map(r => ({ ...r, cachedAt: new Date() }))
      );
    }

    console.log("✅ [CRON] Trending cache refreshed");
  } catch (err) {
    console.error("CRON TRENDING ERROR:", err);
  }
});

connectDB().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});