const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");

const router = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper: create token
function createToken(user) {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing in .env");

  return jwt.sign(
    { userId: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ✅ REGISTER (email + password)
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });

    if (password.length < 6)
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });

    const emailLc = email.toLowerCase();

    const existingUser = await User.findOne({ email: emailLc });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: emailLc,
      password: hashedPassword,
      isVerified: true,
      plan: "free",
      provider: "local",
    });

    const token = createToken(user);

    return res.json({
      message: "User registered",
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ✅ LOGIN (email + password)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const emailLc = email.toLowerCase();
    const user = await User.findOne({ email: emailLc });

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    // If account was created via Google and has no password:
    if (!user.password) {
      return res.status(400).json({
        message: "This account uses Google Sign-In. Please continue with Google.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = createToken(user);

    return res.json({
      message: "Login successful",
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ✅ GOOGLE SIGN-IN (frontend sends Google ID token)
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body; // Google ID token
    if (!credential) {
      return res.status(400).json({ message: "Google credential (id_token) missing" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ message: "GOOGLE_CLIENT_ID missing in .env" });
    }

    // Verify token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) return res.status(401).json({ message: "Invalid Google token" });

    const googleId = payload.sub;
    const email = (payload.email || "").toLowerCase();
    const name = payload.name || "Google User";

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }

    // Find or create user
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name,
        email,
        password: null, // no password for google accounts
        isVerified: true,
        plan: "free",
        provider: "google",
        googleId,
      });
    } else {
      // update provider/googleId if missing
      let changed = false;
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (!user.provider) { user.provider = "google"; changed = true; }
      if (changed) await user.save();
    }

    const token = createToken(user);

    return res.json({
      message: "Google login successful",
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan },
    });
  } catch (err) {
    console.error("❌ /auth/google error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
