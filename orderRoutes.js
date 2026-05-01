const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ─── helper: update food passport after order ───
async function updateFoodPassport(db, userId, cuisine) {
  if (!cuisine) return;
  const ALL_CUISINES = [
    "North Indian", "South Indian", "Chinese", "Italian",
    "Thai", "Mexican", "Continental", "Fast Food",
    "Desserts", "Beverages", "Biryani", "Street Food"
  ];
  const BADGE_THRESHOLDS = [
    { count: 3,  badge: "Explorer" },
    { count: 6,  badge: "Foodie" },
    { count: 12, badge: "Passport Complete" }
  ];
  const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });
  const passport = user.foodPassport || { explored: [], badges: [], couponUnlocked: false };
  const explored = passport.explored || [];
  if (!explored.includes(cuisine)) explored.push(cuisine);
  const badges = passport.badges || [];
  let couponUnlocked = passport.couponUnlocked || false;
  for (const threshold of BADGE_THRESHOLDS) {
    if (explored.length >= threshold.count && !badges.includes(threshold.badge)) {
      badges.push(threshold.badge);
      if (threshold.badge === "Passport Complete" && !couponUnlocked) {
        couponUnlocked = true;
        const couponCode = "PASSPORT" + Math.random().toString(36).substr(2, 6).toUpperCase();
        await db.collection("coupons").insertOne({
          userId: new ObjectId(userId),
          code: couponCode,
          discount: 100,
          type: "flat",
          reason: "Food Passport Complete",
          used: false,
          createdAt: new Date()
        });
      }
    }
  }
  await db.collection("users").updateOne(
    { _id: new ObjectId(userId) },
    { $set: { foodPassport: { explored, badges, couponUnlocked } } }
  );
}

// ─── helper: extract area from address ───
// "123, 5th Cross, Koramangala, Bangalore" → "Koramangala"
function extractArea(address) {
  if (!address) return "Unknown";
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

// ─── helper: assign best available delivery partner ───
// FIX: deliveryPartnerSeed.js stores the area under "serviceArea" field.
//      We now query BOTH "serviceArea" AND "area" so it works regardless of
//      which seed script was used.
// Priority 1 → partner whose serviceArea/area matches the delivery area
// Priority 2 → any available partner (fallback)
// Returns the full delivery document so the caller can send it back to the client.
async function assignDeliveryPartner(db, orderId, delivery_address, delivery_area) {
  let partner = null;

  if (delivery_area && delivery_area !== "Unknown") {
    // Build a case-insensitive regex for the area and the first word of the area
    const areaRegex      = new RegExp(delivery_area, "i");
    const areaWordRegex  = new RegExp(delivery_area.split(" ")[0], "i");

    partner = await db.collection("deliverypartners").findOne({
      available: true,
      $or: [
        { serviceArea: { $regex: areaRegex } },   // ← matches deliveryPartnerSeed.js field
        { area:        { $regex: areaRegex } },   // ← matches seedRestaurantAddresses.js style
        { serviceArea: { $regex: areaWordRegex } },
        { area:        { $regex: areaWordRegex } },
      ]
    });
  }

  // Fallback: any available partner regardless of area
  if (!partner) {
    partner = await db.collection("deliverypartners").findOne({ available: true });
  }

  if (!partner) {
    // No one available — create a pending delivery record and return it
    const pendingDoc = {
      order_id:            orderId,
      delivery_address,
      delivery_area,
      delivery_status:     "Pending Assignment",
      delivery_person:     "TBD",
      delivery_partner_id: null,
      estimated_time:      "TBD",
      delivery_time_mins:  null,
      "Customer Rating-Delivery": null,
      createdAt:           new Date()
    };
    await db.collection("deliveries").insertOne(pendingDoc);
    console.warn(`[Delivery] No partner available for order ${orderId} in area "${delivery_area}"`);
    return pendingDoc;
  }

  // Mark partner as unavailable and link to this order atomically
  await db.collection("deliverypartners").updateOne(
    { _id: partner._id },
    { $set: { available: false, currentOrderId: orderId } }
  );

  // Estimate delivery time: 30 mins if area matches, 40 mins otherwise
  const partnerArea  = partner.serviceArea || partner.area || "";
  const areaMatch    = partnerArea &&
    delivery_area &&
    partnerArea.toLowerCase().includes(delivery_area.toLowerCase());
  const estimatedMins = areaMatch ? 30 : 40;

  const deliveryDoc = {
    order_id:            orderId,
    delivery_address,
    delivery_area,
    delivery_status:     "Assigned",
    delivery_person:     partner.name,          // ← real name always stored here
    delivery_partner_id: partner._id,            // ← needed to free partner on Delivered
    partner_phone:       partner.phone || null,  // ← handy for the UI
    estimated_time:      `${estimatedMins} mins`,
    area_matched:        areaMatch,
    delivery_time_mins:  null,
    "Customer Rating-Delivery": null,
    createdAt:           new Date()
  };

  await db.collection("deliveries").insertOne(deliveryDoc);

  console.log(
    `[Delivery] Assigned ${partner.name} (serviceArea: ${partnerArea || "any"}) ` +
    `to order ${orderId} → area "${delivery_area}" — ETA ${estimatedMins} mins`
  );

  return deliveryDoc;
}

// ─── PLACE ORDER (immediate or scheduled) ───
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      restaurant_id, total_amount, payment_method,
      delivery_address, items, scheduledFor, orderContext,
      razorpay_payment_id, razorpay_order_id, razorpay_signature,
      couponCode
    } = req.body;

    if (!restaurant_id || !total_amount || !delivery_address || !items)
      return res.status(400).json({ message: "Missing required fields" });

    // Razorpay signature verification
    if (payment_method === "Razorpay") {
      if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature)
        return res.status(400).json({ message: "Missing Razorpay payment verification fields" });
      const crypto = require("crypto");
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ message: "Payment verification failed. Invalid signature." });
    }

    if (scheduledFor) {
      const schedTime = new Date(scheduledFor);
      const minTime   = new Date(Date.now() + 30 * 60 * 1000);
      const maxTime   = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      if (schedTime < minTime)
        return res.status(400).json({ message: "Scheduled time must be at least 30 minutes from now" });
      if (schedTime > maxTime)
        return res.status(400).json({ message: "Scheduled time cannot be more than 2 days ahead" });
    }

    const db = getDB();
    const delivery_area = extractArea(delivery_address);

    // ── 1. Coupon validation (before order write) ──────────────────────────────
    let couponDoc       = null;
    let discountAmount  = 0;

    if (couponCode) {
      couponDoc = await db.collection("coupons").findOne({
        userId: new ObjectId(req.user.id),
        code:   couponCode.toUpperCase(),
        used:   false
      });
      if (!couponDoc)
        return res.status(400).json({ message: "Coupon not found or already used" });
      if (couponDoc.minOrder && total_amount < couponDoc.minOrder)
        return res.status(400).json({
          message: `Minimum order of ₹${couponDoc.minOrder} required for this coupon`
        });
      discountAmount = couponDoc.type === "percent"
        ? Math.round(total_amount * couponDoc.discount / 100)
        : couponDoc.discount;
    }

    const finalAmount = Math.max(0, total_amount - discountAmount);

    // ── 2. Create order ─────────────────────────────────────────────────────────
    const orderDoc = {
      user_id:             new ObjectId(req.user.id),
      restaurant_id:       new ObjectId(restaurant_id),
      total_amount:        finalAmount,
      original_amount:     total_amount,
      discount_amount:     discountAmount,
      coupon_used:         couponDoc ? couponDoc.code : null,
      delivery_address,
      delivery_area,
      order_status:        scheduledFor ? "Scheduled" : "Placed",
      orderType:           scheduledFor ? "scheduled" : "immediate",
      scheduledFor:        scheduledFor ? new Date(scheduledFor) : null,
      payment_method:      payment_method || "Cash on Delivery",
      razorpay_payment_id: razorpay_payment_id || null,
      razorpay_order_id:   razorpay_order_id   || null,
      orderContext:        orderContext || null,
      createdAt:           new Date()
    };

    const orderResult = await db.collection("orders").insertOne(orderDoc);
    const orderId = orderResult.insertedId;

    // ── 3. Order items ──────────────────────────────────────────────────────────
    const orderItems = items.map(item => ({
      order_id:  orderId,
      menu_id:   new ObjectId(item.menu_id),
      item_name: item.name,
      quantity:  item.quantity,
      price:     item.price,
      subtotal:  item.price * item.quantity,
      createdAt: new Date()
    }));
    await db.collection("orderitems").insertMany(orderItems);

    // ── 4. Payment record ───────────────────────────────────────────────────────
    await db.collection("payments").insertOne({
      order_id:          orderId,
      payment_method:    payment_method || "Cash on Delivery",
      payment_status:    "Completed",
      transaction_id:    razorpay_payment_id || ("TXN" + Date.now()),
      razorpay_order_id: razorpay_order_id || null,
      payment_date:      new Date(),
      amount:            finalAmount
    });

    // ── 5. Assign delivery partner (immediate orders only) ──────────────────────
    // deliveryDoc is returned so we can include partner name in the response
    let deliveryDoc = null;
    if (!scheduledFor) {
      deliveryDoc = await assignDeliveryPartner(db, orderId, delivery_address, delivery_area);
    }

    // ── 6. Mark coupon as used ─────────────────────────────────────────────────
    if (couponDoc) {
      await db.collection("coupons").updateOne(
        { _id: couponDoc._id },
        { $set: { used: true, usedAt: new Date() } }
      );
    }

    // ── 7. Food passport ────────────────────────────────────────────────────────
    const restaurant = await db.collection("restaurants").findOne({
      _id: new ObjectId(restaurant_id)
    });
    if (restaurant?.cuisine) {
      await updateFoodPassport(db, req.user.id, restaurant.cuisine);
    }

    // ── 8. Open 10-minute reorder window automatically for immediate orders ─────
    // The window is opened right after placement so the user can add items
    // within 10 minutes from the My Orders page.
    let reorderWindowExpiresAt = null;
    if (!scheduledFor) {
      reorderWindowExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await db.collection("orders").updateOne(
        { _id: orderId },
        {
          $set: {
            order_status:           "pending_additions",
            reorderWindowExpiresAt: reorderWindowExpiresAt
          }
        }
      );
    }

    // ── 9. Build response ───────────────────────────────────────────────────────
    const response = {
      message: scheduledFor ? "Order scheduled successfully" : "Order placed successfully",
      orderId,
      // Return delivery info immediately so the frontend can display the partner
      delivery: deliveryDoc
        ? {
            delivery_person:  deliveryDoc.delivery_person,   // real name or "TBD"
            delivery_status:  deliveryDoc.delivery_status,
            estimated_time:   deliveryDoc.estimated_time,
            partner_phone:    deliveryDoc.partner_phone || null
          }
        : null,
      // Reorder window info
      reorderWindow: reorderWindowExpiresAt
        ? { expiresAt: reorderWindowExpiresAt }
        : null,
      // Coupon savings info for the success toast
      discountApplied: discountAmount > 0
        ? { saved: discountAmount, code: couponDoc.code }
        : null
    };

    res.status(201).json(response);

  } catch (error) {
    console.error("ORDER ERROR:", error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── MY ORDERS ───
// Returns orders with their delivery doc and items already joined.
router.get("/myorders", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const orders = await db.collection("orders")
      .find({ user_id: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .toArray();

    const orderIds = orders.map(o => o._id);

    const [deliveries, orderItems] = await Promise.all([
      db.collection("deliveries").find({ order_id: { $in: orderIds } }).toArray(),
      db.collection("orderitems").find({ order_id: { $in: orderIds } }).toArray()
    ]);

    // Enrich with restaurant name
    const restaurantIds = [...new Set(
      orders.map(o => o.restaurant_id?.toString()).filter(Boolean)
    )];
    const restaurants = restaurantIds.length
      ? await db.collection("restaurants")
          .find({ _id: { $in: restaurantIds.map(id => new ObjectId(id)) } })
          .toArray()
      : [];
    const restaurantMap = {};
    restaurants.forEach(r => { restaurantMap[r._id.toString()] = r.name; });

    const result = orders.map(order => ({
      ...order,
      restaurantName: restaurantMap[order.restaurant_id?.toString()] || null,
      delivery: deliveries.find(
        d => d.order_id.toString() === order._id.toString()
      ) || null,
      items: orderItems.filter(
        i => i.order_id.toString() === order._id.toString()
      )
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── REORDER WINDOW: add items to existing order within 10 mins ───
router.post("/add-items/:orderId", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { items } = req.body;

    const order = await db.collection("orders").findOne({
      _id:     new ObjectId(req.params.orderId),
      user_id: new ObjectId(req.user.id)
    });
    if (!order)
      return res.status(404).json({ message: "Order not found" });
    if (order.order_status !== "pending_additions")
      return res.status(400).json({ message: "Reorder window is closed" });
    if (new Date() > new Date(order.reorderWindowExpiresAt))
      return res.status(400).json({ message: "Reorder window has expired" });
    if (!items?.length)
      return res.status(400).json({ message: "No items provided" });

    const newItems = items.map(item => ({
      order_id:  order._id,
      menu_id:   new ObjectId(item.menu_id),
      item_name: item.name,
      quantity:  item.quantity,
      price:     item.price,
      subtotal:  item.price * item.quantity,
      createdAt: new Date()
    }));
    await db.collection("orderitems").insertMany(newItems);

    const additionalAmount = newItems.reduce((sum, i) => sum + i.subtotal, 0);
    await db.collection("orders").updateOne(
      { _id: order._id },
      { $inc: { total_amount: additionalAmount } }
    );

    res.json({
      message:          "Items added to order",
      additionalAmount,
      newTotal:         order.total_amount + additionalAmount,
      windowExpiresAt:  order.reorderWindowExpiresAt
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── OPEN REORDER WINDOW MANUALLY ───
// This is still available in case the admin or user wants to re-open the window
// for an order whose auto-window already closed (e.g., on Delivered orders).
router.put("/open-reorder-window/:orderId", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const order = await db.collection("orders").findOne({
      _id:     new ObjectId(req.params.orderId),
      user_id: new ObjectId(req.user.id)
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.collection("orders").updateOne(
      { _id: order._id },
      { $set: { order_status: "pending_additions", reorderWindowExpiresAt: expiresAt } }
    );
    res.json({ message: "Reorder window opened", expiresAt });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── LIVE ORDER COUNT for a restaurant ───
router.get("/live-count/:restaurantId", async (req, res) => {
  try {
    const db = getDB();
    const activeStatuses = ["Placed", "Confirmed", "Preparing", "pending_additions"];
    const count = await db.collection("orders").countDocuments({
      restaurant_id: new ObjectId(req.params.restaurantId),
      order_status:  { $in: activeStatuses }
    });
    let busynessLabel = "normal";
    if (count > 40)      busynessLabel = "very_busy";
    else if (count > 20) busynessLabel = "busy";
    res.json({ activeOrders: count, busynessLabel });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── RATE AN ORDER ───
router.post("/rate/:orderId", authMiddleware, async (req, res) => {
  try {
    const { deliveryRating, restaurantRating, itemRatings, comment } = req.body;
    const db = getDB();

    const order = await db.collection("orders").findOne({
      _id:     new ObjectId(req.params.orderId),
      user_id: new ObjectId(req.user.id)
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.order_status !== "Delivered")
      return res.status(400).json({ message: "Can only rate delivered orders" });
    if (order.rated)
      return res.status(400).json({ message: "Order already rated" });

    await db.collection("orders").updateOne(
      { _id: order._id },
      {
        $set: {
          rated:             true,
          deliveryRating:    deliveryRating   || 0,
          restaurantRating:  restaurantRating || 0,
          itemRatings:       itemRatings      || {},
          ratingComment:     comment          || "",
          ratedAt:           new Date()
        }
      }
    );

    // Update delivery rating on delivery doc
    if (deliveryRating) {
      await db.collection("deliveries").updateOne(
        { order_id: order._id },
        { $set: { "Customer Rating-Delivery": deliveryRating } }
      );
    }

    // Rolling-average restaurant rating
    if (restaurantRating && order.restaurant_id) {
      const restaurant = await db.collection("restaurants").findOne({
        _id: order.restaurant_id
      });
      if (restaurant) {
        const prev  = restaurant.avgRating    || 0;
        const count = restaurant.totalRatings || 0;
        const newAvg = parseFloat(
          ((prev * count + restaurantRating) / (count + 1)).toFixed(2)
        );
        await db.collection("restaurants").updateOne(
          { _id: order.restaurant_id },
          { $set: { avgRating: newAvg }, $inc: { totalRatings: 1 } }
        );
      }
    }

    res.json({ message: "Rating submitted. Thank you!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;