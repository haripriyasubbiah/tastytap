const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const crypto = require("crypto");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── CREATE GROUP ORDER ROOM ───
router.post("/create", authMiddleware, async (req, res) => {
  try {
    const { restaurant_id, paymentMode, budgetPerPerson, deadline } = req.body;
    if (!restaurant_id || !paymentMode)
      return res.status(400).json({ message: "restaurant_id and paymentMode are required" });
    if (!["host_pays", "split"].includes(paymentMode))
      return res.status(400).json({ message: "paymentMode must be host_pays or split" });

    const db = getDB();
    const roomCode = generateRoomCode();
    const room = {
      roomCode,
      hostUserId: new ObjectId(req.user.id),
      restaurant_id: new ObjectId(restaurant_id),
      paymentMode,
      budgetPerPerson: paymentMode === "host_pays" ? (budgetPerPerson || null) : null,
      deadline: deadline ? new Date(deadline) : null,
      status: "open",
      members: [{
        userId: new ObjectId(req.user.id),
        isHost: true,
        items: [],
        subtotal: 0,
        hasPaid: paymentMode === "host_pays" ? null : false
      }],
      createdAt: new Date()
    };
    await db.collection("grouporders").insertOne(room);
    res.status(201).json({ message: "Room created", roomCode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── JOIN ROOM ───
// If user is already in the room, returns success (idempotent rejoin)
router.post("/join/:roomCode", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.status !== "open") return res.status(400).json({ message: "Room is no longer open" });
    if (room.deadline && new Date() > new Date(room.deadline))
      return res.status(400).json({ message: "Ordering deadline has passed" });

    const alreadyJoined = room.members.some(m => m.userId.toString() === req.user.id);
    // Already in room — treat as successful rejoin
    if (alreadyJoined) {
      return res.json({ message: "Rejoined room", roomCode: req.params.roomCode, rejoined: true });
    }

    await db.collection("grouporders").updateOne(
      { roomCode: req.params.roomCode },
      {
        $push: {
          members: {
            userId: new ObjectId(req.user.id),
            isHost: false,
            items: [],
            subtotal: 0,
            hasPaid: room.paymentMode === "host_pays" ? null : false
          }
        }
      }
    );
    res.json({ message: "Joined room successfully", roomCode: req.params.roomCode });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── ADD ITEMS TO ROOM ───
router.post("/add-items/:roomCode", authMiddleware, async (req, res) => {
  try {
    const { items } = req.body;
    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.status !== "open") return res.status(400).json({ message: "Room is closed" });
    if (room.deadline && new Date() > new Date(room.deadline))
      return res.status(400).json({ message: "Ordering deadline has passed" });

    const memberIndex = room.members.findIndex(m => m.userId.toString() === req.user.id);
    if (memberIndex === -1) return res.status(403).json({ message: "You are not in this room" });

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    if (room.paymentMode === "host_pays" && room.budgetPerPerson) {
      if (subtotal > room.budgetPerPerson)
        return res.status(400).json({ message: `Your order exceeds the budget cap of ₹${room.budgetPerPerson}` });
    }

    const updatedMembers = [...room.members];
    updatedMembers[memberIndex].items = items;
    updatedMembers[memberIndex].subtotal = subtotal;

    await db.collection("grouporders").updateOne(
      { roomCode: req.params.roomCode },
      { $set: { members: updatedMembers } }
    );
    res.json({ message: "Items added", subtotal });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── GET ROOM STATE ───
router.get("/room/:roomCode", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });

    const enrichedMembers = await Promise.all(room.members.map(async (m) => {
      const user = await db.collection("users").findOne(
        { _id: m.userId }, { projection: { name: 1 } }
      );
      return { ...m, name: user ? user.name : "Unknown", hasAddedItems: m.items && m.items.length > 0 };
    }));
    res.json({ ...room, members: enrichedMembers });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── HOST: KICK A MEMBER ───
router.put("/kick/:roomCode/:userId", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.hostUserId.toString() !== req.user.id)
      return res.status(403).json({ message: "Only the host can kick members" });
    if (req.params.userId === req.user.id)
      return res.status(400).json({ message: "Host cannot kick themselves" });

    await db.collection("grouporders").updateOne(
      { roomCode: req.params.roomCode },
      { $pull: { members: { userId: new ObjectId(req.params.userId) } } }
    );
    res.json({ message: "Member removed" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── HOST: SET DEADLINE ───
router.put("/deadline/:roomCode", authMiddleware, async (req, res) => {
  try {
    const { deadline } = req.body;
    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.hostUserId.toString() !== req.user.id)
      return res.status(403).json({ message: "Only the host can set a deadline" });

    await db.collection("grouporders").updateOne(
      { roomCode: req.params.roomCode },
      { $set: { deadline: new Date(deadline) } }
    );
    res.json({ message: "Deadline set", deadline });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── HOST: CLOSE ROOM AND CHECKOUT (with Razorpay verification) ───
router.post("/checkout/:roomCode", authMiddleware, async (req, res) => {
  try {
    const {
      delivery_address,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = req.body;

    const db = getDB();
    const room = await db.collection("grouporders").findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.hostUserId.toString() !== req.user.id)
      return res.status(403).json({ message: "Only the host can checkout" });
    if (room.status !== "open") return res.status(400).json({ message: "Room already checked out" });

    // Razorpay signature verification
    if (razorpay_payment_id && razorpay_order_id && razorpay_signature) {
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("hex");
      if (expectedSig !== razorpay_signature) {
        return res.status(400).json({ message: "Payment verification failed" });
      }
    }

    const allItems = [];
    let totalAmount = 0;
    for (const member of room.members) {
      for (const item of member.items) allItems.push(item);
      totalAmount += member.subtotal;
    }
    if (!allItems.length) return res.status(400).json({ message: "No items in the room" });

    const orderResult = await db.collection("orders").insertOne({
      user_id: room.hostUserId,
      restaurant_id: room.restaurant_id,
      total_amount: totalAmount,
      delivery_address,
      delivery_area: delivery_address ? delivery_address.split(",").slice(-2)[0].trim() : "",
      order_status: "Placed",
      orderType: "group",
      paymentMode: room.paymentMode,
      groupRoomCode: room.roomCode,
      payment_method: razorpay_payment_id ? "Razorpay" : "Online",
      razorpay_payment_id: razorpay_payment_id || null,
      createdAt: new Date()
    });
    const orderId = orderResult.insertedId;

    const orderItems = allItems.map(item => ({
      order_id: orderId,
      menu_id: item.menu_id ? new ObjectId(item.menu_id) : null,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.price * item.quantity,
      createdAt: new Date()
    }));
    await db.collection("orderitems").insertMany(orderItems);

    // Payment records
    if (room.paymentMode === "host_pays") {
      await db.collection("payments").insertOne({
        order_id: orderId,
        payment_method: razorpay_payment_id ? "Razorpay" : "Online",
        payment_status: "Completed",
        transaction_id: razorpay_payment_id || ("TXN" + Date.now()),
        razorpay_order_id: razorpay_order_id || null,
        payment_date: new Date(),
        amount: totalAmount,
        paidBy: "host"
      });
    } else {
      for (const member of room.members) {
        await db.collection("payments").insertOne({
          order_id: orderId,
          payment_method: razorpay_payment_id ? "Razorpay" : "Online",
          payment_status: "Completed",
          transaction_id: razorpay_payment_id || ("TXN" + Date.now() + Math.random()),
          payment_date: new Date(),
          amount: member.subtotal,
          paidBy: member.userId,
          splitPayment: true
        });
      }
    }

    // Assign delivery partner (non-blocking)
    const partners = await db.collection("deliverypartners").find({ available: true }).toArray();
    if (partners.length) {
      const partner = partners[Math.floor(Math.random() * partners.length)];
      await db.collection("deliverypartners").updateOne(
        { _id: partner._id }, { $set: { available: false } }
      );
      await db.collection("deliveries").insertOne({
        order_id: orderId,
        delivery_address,
        delivery_status: "Assigned",
        delivery_person: partner.name,
        estimated_time: "45 mins",
        delivery_time_mins: null,
        "Customer Rating-Delivery": null,
        createdAt: new Date()
      });
    } else {
      await db.collection("deliveries").insertOne({
        order_id: orderId,
        delivery_address,
        delivery_status: "Pending Assignment",
        delivery_person: "TBD",
        estimated_time: "TBD",
        delivery_time_mins: null,
        "Customer Rating-Delivery": null,
        createdAt: new Date()
      });
    }

    await db.collection("grouporders").updateOne(
      { roomCode: req.params.roomCode },
      { $set: { status: "placed", placedOrderId: orderId } }
    );

    res.status(201).json({ message: "Group order placed successfully", orderId, totalAmount, paymentMode: room.paymentMode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;