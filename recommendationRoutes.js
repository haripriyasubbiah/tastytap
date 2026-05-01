const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");
const https = require("https");

const router = express.Router();

// ─── helper: get time slot from current hour ───
function getTimeSlot(hour) {
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "afternoon";
  if (hour >= 15 && hour < 19) return "evening";
  return "night";
}

// ─── helper: fetch weather from OpenWeatherMap (free tier) ───
function fetchWeather(city) {
  return new Promise((resolve) => {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return resolve(null);

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;

    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            condition: parsed.weather[0].main.toLowerCase(), // rain, clear, clouds, etc.
            temp: parsed.main.temp
          });
        } catch {
          resolve(null);
        }
      });
    }).on("error", () => resolve(null));
  });
}

// ─── mood → cuisine affinity map ───
// Two groups:
//   Emotional moods  — how you're feeling (sad, happy, stressed …)
//   Craving moods    — what kind of food experience you want (comfort, light …)
// Both work identically in the scoring engine — the split is only for the UI.
const moodMap = {

  // ── Emotional moods ──
  sad: {
    cuisines: ["Desserts", "North Indian", "Fast Food", "Biryani"],
    message: "Sending you a virtual hug 🤗 Here's something warm and indulgent to cheer you up.",
    foodNote: "Cheesy, creamy, sweet — classic mood-lifters."
  },
  happy: {
    cuisines: ["Street Food", "Chinese", "Fast Food", "Beverages"],
    message: "You're glowing ✨ Let's celebrate with some fun street bites!",
    foodNote: "Chaat, momos, pani puri — food that matches your energy."
  },
  stressed: {
    cuisines: ["Biryani", "North Indian", "Desserts", "South Indian"],
    message: "Take a breath. Let good food do the rest 🌿",
    foodNote: "Hearty, filling meals — the kind that make everything feel smaller."
  },
  bored: {
    cuisines: ["Mexican", "Thai", "Continental", "Chinese"],
    message: "Time to shake things up a bit! 🌶️",
    foodNote: "Bold flavours and new textures — antidote to a flat day."
  },
  romantic: {
    cuisines: ["Italian", "Continental", "Desserts", "Beverages"],
    message: "Setting the mood with something special 🕯️",
    foodNote: "Pasta, fondue, tiramisu — date night sorted."
  },
  anxious: {
    cuisines: ["South Indian", "Beverages", "Street Food"],
    message: "Something gentle and grounding for you 🌱",
    foodNote: "Familiar, light, easy — no overwhelm on the plate."
  },
  nostalgic: {
    cuisines: ["Biryani", "Street Food", "North Indian", "South Indian"],
    message: "A trip down memory lane, one bite at a time 🏡",
    foodNote: "The classics that remind you of home."
  },
  energetic: {
    cuisines: ["Street Food", "Fast Food", "Chinese", "Mexican"],
    message: "You're on fire! 🔥 Fuel up fast.",
    foodNote: "Quick, punchy, satisfying — keep that momentum going."
  },

  // ── Craving / situational moods (original, preserved exactly) ──
  comfort: {
    cuisines: ["North Indian", "Biryani", "Street Food"],
    message: "Sounds like you need something warm and hearty.",
    foodNote: "Dal, paneer, butter naan — the ultimate comfort combo."
  },
  adventurous: {
    cuisines: ["Thai", "Mexican", "Continental", "Italian"],
    message: "Let's try something new today!",
    foodNote: "Step outside your usual order — you might find a new favourite."
  },
  light: {
    cuisines: ["South Indian", "Beverages", "Street Food"],
    message: "Keeping it light and easy.",
    foodNote: "Idli, poha, fresh juices — clean and satisfying."
  },
  celebratory: {
    cuisines: ["Continental", "Italian", "Desserts", "Biryani"],
    message: "Time to celebrate with something special!",
    foodNote: "Go all out — you've earned it."
  },
  tired: {
    cuisines: ["Biryani", "North Indian", "Fast Food"],
    message: "Long day? Here's something quick and satisfying.",
    foodNote: "One-pot meals, quick bites — minimal effort, maximum comfort."
  }
};

// ─── weather → cuisine affinity override ───
const weatherBoost = {
  rain: ["Biryani", "North Indian", "Street Food", "Beverages"],
  clear: ["Continental", "South Indian", "Beverages"],
  clouds: ["North Indian", "Fast Food", "Street Food"],
  snow: ["North Indian", "Biryani", "Beverages"]
};

// ─── time slot → cuisine affinity ───
const timeBoost = {
  morning: ["South Indian", "Beverages", "Street Food"],
  afternoon: ["Biryani", "North Indian", "Fast Food", "South Indian"],
  evening: ["Street Food", "Fast Food", "Beverages", "Desserts"],
  night: ["Biryani", "North Indian", "Continental", "Fast Food"]
};

// ─── GET RECOMMENDATIONS ───
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { mood } = req.body;
    const db = getDB();

    // 1 - get user
    const user = await db.collection("users").findOne({
      _id: new ObjectId(req.user.id)
    });

    // 2 - time context
    const now = new Date();
    const timeSlot = getTimeSlot(now.getHours());

    // 3 - weather context
    const city = user.city || (user.address ? user.address.split(",").pop().trim() : null);
    const weather = city ? await fetchWeather(city) : null;

    // 4 - user's last 5 order cuisines
    const pastOrders = await db.collection("orders")
      .find({ user_id: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    const pastRestaurantIds = pastOrders.map(o => o.restaurant_id);
    const pastRestaurants = await db.collection("restaurants")
      .find({ _id: { $in: pastRestaurantIds } })
      .toArray();
    const pastCuisines = pastRestaurants.map(r => r.cuisine).filter(Boolean);

    // 5 - build a scoring map for cuisines
    const cuisineScores = {};

    const addScore = (cuisines, weight) => {
      for (const c of cuisines) {
        cuisineScores[c] = (cuisineScores[c] || 0) + weight;
      }
    };

    // mood is highest weight
    if (mood && moodMap[mood]) {
      addScore(moodMap[mood].cuisines, 3);
    }

    // time slot
    addScore(timeBoost[timeSlot] || [], 2);

    // weather
    if (weather && weatherBoost[weather.condition]) {
      addScore(weatherBoost[weather.condition], 2);
    }

    // de-prioritise recently ordered cuisines (variety)
    for (const c of pastCuisines) {
      cuisineScores[c] = (cuisineScores[c] || 0) - 1;
    }

    // 6 - sort cuisines by score
    const rankedCuisines = Object.entries(cuisineScores)
      .sort((a, b) => b[1] - a[1])
      .map(([cuisine]) => cuisine);

    // 7 - find restaurants matching top cuisines
    const topCuisines = rankedCuisines.slice(0, 4);

    const restaurants = await db.collection("restaurants")
      .find({ cuisine: { $in: topCuisines } })
      .limit(10)
      .toArray();

    // 8 - build message
    const moodData = mood && moodMap[mood] ? moodMap[mood] : null;
    const moodText = moodData ? moodData.message : "Here's what we think you'll love right now.";
    const weatherText = weather
      ? `It's ${weather.condition} outside (${Math.round(weather.temp)}°C).`
      : "";
    const timeText = `It's ${timeSlot} right now.`;

    const message = [weatherText, timeText, moodText].filter(Boolean).join(" ");

    res.json({
      message,
      foodNote: moodData?.foodNote || null,   // shown as flavour note in UI
      context: {
        mood: mood || null,
        timeSlot,
        weather: weather || null,
        pastCuisines
      },
      recommendedCuisines: topCuisines,
      restaurants
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── GET USER'S ORDERING PATTERNS (insight card) ───
router.get("/patterns", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const orders = await db.collection("orders")
      .find({
        user_id: new ObjectId(req.user.id),
        orderContext: { $ne: null }
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    if (!orders.length)
      return res.json({ patterns: [], message: "Order more to unlock your patterns!" });

    // find most common mood per time slot
    const moodBySlot = {};
    const cuisineByWeather = {};

    for (const order of orders) {
      const ctx = order.orderContext;
      if (!ctx) continue;

      const key = ctx.timeSlot;
      if (key && ctx.mood) {
        if (!moodBySlot[key]) moodBySlot[key] = {};
        moodBySlot[key][ctx.mood] = (moodBySlot[key][ctx.mood] || 0) + 1;
      }

      if (ctx.weather && ctx.weather.condition) {
        const w = ctx.weather.condition;
        if (!cuisineByWeather[w]) cuisineByWeather[w] = {};
      }
    }

    const patterns = [];

    for (const [slot, moods] of Object.entries(moodBySlot)) {
      const topMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0];
      if (topMood && topMood[1] >= 2) {
        patterns.push(`You often feel ${topMood[0]} during ${slot} orders.`);
      }
    }

    res.json({ patterns });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;