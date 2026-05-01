const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ─── GET NEIGHBOURHOOD TRENDING ───
// reads from trendingcache (refreshed every 15 mins by cron in server.js)
// falls back to live query if cache is empty
router.get("/neighbourhood", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    // get user's area from their profile
    const user = await db.collection("users").findOne({
      _id: new ObjectId(req.user.id)
    });

    const userArea = extractArea(user.address || "");

    if (!userArea || userArea === "Unknown")
      return res.status(400).json({ message: "Please set your address to see neighbourhood trends" });

    // try cache first
    let cached = await db.collection("trendingcache")
      .find({ "_id.area": userArea })
      .sort({ count: -1 })
      .limit(10)
      .toArray();

    // if cache miss, do live query
    if (!cached.length) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      cached = await db.collection("orders").aggregate([
        {
          $match: {
            delivery_area: userArea,
            createdAt: { $gte: twoHoursAgo }
          }
        },
        {
          $group: {
            _id: "$restaurant_id",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();
    }

    // enrich with restaurant names
    const enriched = await Promise.all(cached.map(async (entry) => {
      const restaurantId = entry._id?.restaurant_id || entry._id;
      let restaurant = null;
      try {
        restaurant = await db.collection("restaurants").findOne({
          _id: new ObjectId(restaurantId)
        });
      } catch (e) { }

      return {
        restaurantId,
        restaurantName: restaurant ? restaurant.name : "Unknown",
        cuisine: restaurant ? restaurant.cuisine : null,
        orderCount: entry.count
      };
    }));

    // also get trending cuisine in the area
    const cuisineCounts = {};
    for (const item of enriched) {
      if (item.cuisine) {
        cuisineCounts[item.cuisine] = (cuisineCounts[item.cuisine] || 0) + item.orderCount;
      }
    }

    const topCuisine = Object.entries(cuisineCounts)
      .sort((a, b) => b[1] - a[1])[0];

    res.json({
      area: userArea,
      topRestaurants: enriched,
      topCuisine: topCuisine ? topCuisine[0] : null,
      message: `Trending in ${userArea} right now`
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

function extractArea(address) {
  if (!address) return "Unknown";
  const parts = address.split(",");
  return parts.length >= 2 ? parts[parts.length - 2].trim() : parts[0].trim();
}

module.exports = router;