// ✅ FIXED: from server/middleware/usageLimit.js → models/User.js
const User = require("../../models/User");

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDailyLimit(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "unlimited") return 999;
  if (p === "pro") return 100;
  if (p === "basic") return 25;
  return 5; // free
}

async function usageLimit(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const today = startOfToday();

    // Reset counter at start of new day
    if (!user.dailyResetAt || user.dailyResetAt < today) {
      user.dailyResetAt = today;
      user.dailyCount = 0;
      await user.save();
    }

    const limit = getDailyLimit(user.plan);

    if (user.dailyCount >= limit) {
      return res.status(429).json({
        message: `Daily limit reached (${limit}/day on ${user.plan} plan). Upgrade to get more.`,
        limitReached: true,
        plan: user.plan,
        limit,
      });
    }

    // Pass usage info to route handler
    req.usage = {
      used: user.dailyCount + 1,
      limit,
      plan: user.plan,
    };

    next();
  } catch (err) {
    console.error("Usage limit error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = usageLimit;