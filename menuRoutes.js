const express = require("express");
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ─── ADD MENU ITEM (restaurant side) ───
router.post("/", async (req, res) => {
  try {
    const {
      restaurant_id, item_name, category, price,
      availability, description,
      dietaryTags, allergens, calories, prepTimeMinutes
    } = req.body;

    const db = getDB();
    const result = await db.collection("menus").insertOne({
      restaurant_id: new ObjectId(restaurant_id),
      item_name, category, price, availability, description,
      dietaryTags: dietaryTags || [],
      allergens: allergens || [],
      calories: calories || null,
      prepTimeMinutes: prepTimeMinutes || null,
      avgRating: null,
      totalRatings: 0
    });

    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET MENU BY RESTAURANT ───
// Always returns ALL items. When auth header is present, items are annotated with:
//   containsAllergen: true  — item contains one or more of the user's flagged allergens
//   matchesPreference: false — item has dietary tags that CONFLICT with user's preferences
//
// Conflict logic (what gets blocked when filter is ON):
//   - If the user has no preferences saved → nothing is blocked on preference grounds
//   - If the user has preferences saved → an item is only blocked if it has at least one
//     dietary tag that directly contradicts a user preference.
//     Items with NO dietary tags are treated as neutral and are never blocked.
//
// Conflict map (tag on item → preference it conflicts with):
//   "non-vegetarian" conflicts with vegetarian, vegan, jain, eggetarian
//   "contains-egg"   conflicts with vegan, jain, vegetarian
//   "contains-meat"  conflicts with vegetarian, vegan, jain, eggetarian, halal (if not halal-certified)
//   "contains-pork"  conflicts with halal, jain
//   "contains-gluten" conflicts with gluten-free
//   "contains-dairy"  conflicts with dairy-free, vegan
//
// Because most existing menu items won't have explicit conflict tags, we use the
// REVERSE approach: if the user wants vegetarian, block only items explicitly tagged
// "non-vegetarian". This is far less aggressive than requiring a positive match.

// Maps a user preference to the item tags that would disqualify it.
const PREFERENCE_BLOCKLIST = {
  "vegetarian":  ["non-vegetarian", "contains-meat", "contains-pork"],
  "vegan":       ["non-vegetarian", "contains-meat", "contains-pork", "contains-egg", "contains-dairy", "contains-honey"],
  "jain":        ["non-vegetarian", "contains-meat", "contains-pork", "contains-egg", "contains-root-vegetables"],
  "halal":       ["contains-pork", "non-halal"],
  "eggetarian":  ["non-vegetarian", "contains-meat", "contains-pork"],
  "gluten-free": ["contains-gluten"],
  "dairy-free":  ["contains-dairy"],
};

router.get("/:restaurantId", async (req, res) => {
  try {
    const db = getDB();

    let items = await db.collection("menus").find({
      restaurant_id: new ObjectId(req.params.restaurantId)
    }).toArray();

    // Try to get user profile if auth header is present
    let userProfile = null;
    const authHeader = req.header("Authorization");
    if (authHeader) {
      try {
        const jwt = require("jsonwebtoken");
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await db.collection("users").findOne({
          _id: new ObjectId(decoded.id)
        });
        if (user) {
          userProfile = {
            allergies: user.allergies || [],
            dietaryPreferences: user.dietaryPreferences || []
          };
        }
      } catch (e) {
        // Token invalid or missing — skip annotation
      }
    }

    // Annotate items with allergen warnings and preference conflicts
    items = items.map(item => {
      const annotated = { ...item };

      if (userProfile) {
        // ── Allergen check ──
        // True if the item contains any ingredient the user is allergic to.
        annotated.containsAllergen = userProfile.allergies.some(a =>
          (item.allergens || []).map(x => x.toLowerCase()).includes(a.toLowerCase())
        );

        // ── Preference conflict check ──
        // If user has no preferences saved, nothing is blocked.
        // If user has preferences, block only items that have a tag explicitly
        // conflicting with at least one of the user's preferences.
        // Items with empty dietaryTags are NEUTRAL — never blocked.
        if (userProfile.dietaryPreferences.length === 0) {
          annotated.matchesPreference = true;
        } else {
          const itemTags = (item.dietaryTags || []).map(x => x.toLowerCase());

          if (itemTags.length === 0) {
            // No tags on item → treat as neutral, don't block
            annotated.matchesPreference = true;
          } else {
            // Collect all disqualifying tags across the user's preferences
            const blockedTags = new Set();
            for (const pref of userProfile.dietaryPreferences) {
              const blocked = PREFERENCE_BLOCKLIST[pref.toLowerCase()] || [];
              blocked.forEach(t => blockedTags.add(t));
            }

            // Item conflicts if any of its tags appear in the blocked set
            const hasConflict = itemTags.some(tag => blockedTags.has(tag));
            annotated.matchesPreference = !hasConflict;
          }
        }
      }

      return annotated;
    });

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── UPDATE MENU ITEM ───
router.put("/:itemId", async (req, res) => {
  try {
    const db = getDB();
    const updates = req.body;

    await db.collection("menus").updateOne(
      { _id: new ObjectId(req.params.itemId) },
      { $set: updates }
    );

    res.json({ message: "Menu item updated" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;