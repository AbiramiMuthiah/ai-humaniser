const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
// ✅ FIXED: correct path from routes/auth.js → models/User.js
const User = require("../models/User");

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

/* ── Register ──────────────────────────────── */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const user = await User.create({ name, email, password, provider: "local" });
    const token = signToken(user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── Login ─────────────────────────────────── */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ FIXED: uses comparePassword method (added to User model)
    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = signToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── Google OAuth ──────────────────────────── */
router.post("/google", async (req, res) => {
  try {
    const { credential, googleUser } = req.body;

    let googleId, email, name, email_verified;

    if (googleUser) {
      // New flow: useGoogleLogin hook sends googleUser object
      email = googleUser.email;
      name = googleUser.name;
      googleId = googleUser.googleId;
      email_verified = true;
    } else if (credential) {
      // Old flow: GoogleLogin component sends JWT credential
      const parts = credential.split(".");
      if (parts.length !== 3) {
        return res.status(400).json({ message: "Invalid Google token format" });
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      } catch {
        return res.status(400).json({ message: "Could not decode Google token" });
      }
      googleId = payload.sub;
      email = payload.email;
      name = payload.name;
      email_verified = payload.email_verified;
    } else {
      return res.status(400).json({ message: "Missing Google credential" });
    }

    if (!email || !googleId) {
      return res.status(400).json({ message: "Google token missing email or id" });
    }

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      user = await User.create({
        name: name || email.split("@")[0],
        email: email.toLowerCase(),
        googleId,
        provider: "google",
        isVerified: email_verified || false,
        plan: "free",
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      user.provider = "google";
      await user.save();
    }

    const token = signToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ message: "Google authentication failed" });
  }
});

module.exports = router;