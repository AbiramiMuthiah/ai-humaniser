const jwt = require("jsonwebtoken");
// ✅ FIXED: from server/middleware/authMiddleware.js → models/User.js
const User = require("../../models/User");

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id };

    // Fetch plan info for usageLimit middleware
    const user = await User.findById(decoded.id).select("plan dailyCount dailyResetAt");
    if (!user) return res.status(401).json({ message: "User not found" });

    req.user.plan = user.plan;
    req.user.dailyCount = user.dailyCount;
    req.user.dailyResetAt = user.dailyResetAt;

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = authMiddleware;