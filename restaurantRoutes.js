const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");

const router = express.Router();

// ─── Haversine formula — distance in km between two lat/lng points ───────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── CREATE RESTAURANT ───────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection("restaurants").insertOne(req.body);
    res.json({ _id: result.insertedId, ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET ALL RESTAURANTS ─────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    const restaurants = await db.collection("restaurants").find({}).toArray();
    res.json(restaurants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET NEARBY RESTAURANTS ───────────────────────────────────────────────────
// Query params:
//   lat       — user's latitude  (required)
//   lng       — user's longitude (required)
//   radiusKm  — filter radius in km (optional, default 25)
//
// Returns only restaurants that have lat/lng stored, sorted by distance ASC.
// Each result gets a `distanceKm` field so the frontend can show "X.X km away".
//
// NOTE: /nearby must be declared BEFORE /:restaurantId so Express doesn't
// treat "nearby" as a Mongo ObjectId and crash.
router.get("/nearby", async (req, res) => {
  try {
    const userLat = parseFloat(req.query.lat);
    const userLng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm) || 25;

    if (isNaN(userLat) || isNaN(userLng)) {
      return res
        .status(400)
        .json({ message: "lat and lng query params are required" });
    }

    const db = getDB();

    // Only fetch restaurants that actually have coordinates stored
    const restaurants = await db
      .collection("restaurants")
      .find({ lat: { $exists: true, $ne: null }, lng: { $exists: true, $ne: null } })
      .toArray();

    const withDistance = restaurants
      .map((r) => ({
        ...r,
        distanceKm: parseFloat(
          haversineKm(userLat, userLng, r.lat, r.lng).toFixed(1)
        ),
      }))
      .filter((r) => r.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json(withDistance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET SINGLE RESTAURANT ───────────────────────────────────────────────────
router.get("/:restaurantId", async (req, res) => {
  try {
    const db = getDB();
    const restaurant = await db.collection("restaurants").findOne({
      _id: new ObjectId(req.params.restaurantId),
    });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found" });
    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;