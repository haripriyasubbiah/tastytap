const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");
const bcrypt = require("bcryptjs");

const router = express.Router();

const VALID_DIETARY_PREFERENCES = [
  "vegetarian", "vegan", "jain", "halal",
  "eggetarian", "gluten-free", "dairy-free"
];

const VALID_ALLERGENS = [
  "peanuts", "dairy", "gluten", "shellfish",
  "eggs", "soy", "tree nuts", "fish"
];

// ─── GET MY PROFILE ───
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── UPDATE BASIC PROFILE (name, phone, address, city) ───
router.put("/update-profile", authMiddleware, async (req, res) => {
  try {
    const { name, phone, address, city } = req.body;
    const db = getDB();

    if (name !== undefined && !name.trim())
      return res.status(400).json({ message: "Name cannot be empty" });

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (address !== undefined) updates.address = address.trim();
    if (city !== undefined) updates.city = city.trim();

    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: updates }
    );

    res.json({ message: "Profile updated", ...updates });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── CHANGE PASSWORD ───
router.put("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Both currentPassword and newPassword are required" });
    if (newPassword.length < 6)
      return res.status(400).json({ message: "New password must be at least 6 characters" });

    const db = getDB();
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ message: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: "Current password is incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { password: hashed } }
    );

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── UPDATE DIETARY PROFILE (preferences + allergies) ───
router.put("/dietary-profile", authMiddleware, async (req, res) => {
  try {
    const { dietaryPreferences, allergies } = req.body;
    const db = getDB();

    const updates = {};

    if (dietaryPreferences !== undefined) {
      const invalid = dietaryPreferences.filter(
        p => !VALID_DIETARY_PREFERENCES.includes(p.toLowerCase())
      );
      if (invalid.length)
        return res.status(400).json({
          message: `Invalid preferences: ${invalid.join(", ")}`,
          validOptions: VALID_DIETARY_PREFERENCES
        });
      updates.dietaryPreferences = dietaryPreferences.map(p => p.toLowerCase());
    }

    if (allergies !== undefined) {
      const invalid = allergies.filter(
        a => !VALID_ALLERGENS.includes(a.toLowerCase())
      );
      if (invalid.length)
        return res.status(400).json({
          message: `Invalid allergens: ${invalid.join(", ")}`,
          validOptions: VALID_ALLERGENS
        });
      updates.allergies = allergies.map(a => a.toLowerCase());
    }

    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: updates }
    );

    res.json({ message: "Dietary profile updated", ...updates });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ─── GET DIETARY PROFILE OPTIONS (for frontend dropdowns) ───
router.get("/dietary-options", async (req, res) => {
  res.json({
    dietaryPreferences: VALID_DIETARY_PREFERENCES,
    allergens: VALID_ALLERGENS
  });
});

module.exports = router;