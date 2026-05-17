const User = require("../../models/User");

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function getDailyLimit(plan) {
  const p = String(plan || "free").toLowerCase();

  // Tune these as you like
  if (p === "pro") return 100;
  if (p === "plus") return 25;
  return 5; // free
}

const usageLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await User.findById(userId).select("plan dailyCount dailyResetAt");
    if (!user) return res.status(401).json({ message: "User not found" });

    const dailyLimit = getDailyLimit(user.plan);
    const today = startOfToday();

    // Reset usage daily
    if (!user.dailyResetAt || user.dailyResetAt < today) {
      user.dailyResetAt = today;
      user.dailyCount = 0;
    }

    // Check limit for all plans (even pro/plus)
    // If you want PRO unlimited, set getDailyLimit('pro') to a huge number.
    if (user.dailyCount >= dailyLimit) {
      return res.status(429).json({
        message: `Daily limit reached (${dailyLimit}/day). Upgrade to continue.`,
        usage: {
          plan: user.plan,
          usedToday: user.dailyCount,
          limitToday: dailyLimit,
        },
      });
    }

    // Increment BEFORE calling AI
    user.dailyCount += 1;
    await user.save();

    // Attach for UI
    req.usage = {
      plan: user.plan,
      usedToday: user.dailyCount,
      limitToday: dailyLimit,
    };

    next();
  } catch (err) {
    req.usage = { plan, usedToday, limitToday }
    return res.status(500).json({ message: "Limit check error", error: err.message });
  }
};

module.exports = usageLimit;