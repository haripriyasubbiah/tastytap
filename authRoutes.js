const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDB } = require("../db");

const router = express.Router();

// ─── REGISTER ───
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, address, city } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email and password are required" });

    const db = getDB();
    const existingUser = await db.collection("users").findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").insertOne({
      name,
      email,
      password: hashedPassword,
      phone: phone || "",
      address: address || "",
      city: city || "",
      role: "user",
      dietaryPreferences: [],   // e.g. ["vegan", "jain"]
      allergies: [],             // e.g. ["peanuts", "dairy"]
      foodPassport: {
        explored: [],
        badges: [],
        couponUnlocked: false
      },
      createdAt: new Date()
    });

    res.status(201).json({ message: "Registration successful" });

  } catch (error) {
    console.log("REGISTER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── LOGIN ───
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const db = getDB();
    const user = await db.collection("users").findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Invalid email" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token, role: user.role });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;