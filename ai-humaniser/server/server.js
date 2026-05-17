require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const connectDB = require("../config/db");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const Text = require("../models/Text");
const User = require("../models/User");

const authRoutes = require("../routes/auth");
const authMiddleware = require("./middleware/authMiddleware");
const usageLimit = require("./middleware/usageLimit");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

/* =======================================
   STRIPE WEBHOOK - MUST BE BEFORE JSON
======================================= */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        const user = await User.findOne({
          email: session.customer_email,
        });

        if (user) {
          user.plan = "pro";
          user.dailyCount = 0;
          user.dailyResetAt = startOfToday();
          await user.save();

          console.log("User upgraded:", user.email);
        }
      } catch (err) {
        console.log("Webhook DB error:", err);
      }
    }

    res.json({ received: true });
  }
);

/* =======================================
   NORMAL MIDDLEWARE
======================================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* =======================================
   ROUTES
======================================= */
app.use("/auth", authRoutes);

/* =======================================
   STRIPE CHECKOUT
======================================= */
app.post("/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: user.email,
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ message: "Payment session failed" });
  }
});

/* =======================================
   GEMINI SETUP
======================================= */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const model = genAI.getGenerativeModel({
  model: "models/gemini-2.5-flash",
});

/* =======================================
   HEALTH
======================================= */
app.get("/", (req, res) => {
  res.send("AI Humaniser backend is running!");
});

/* =======================================
   HELPERS
======================================= */
function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function getDailyLimit(plan) {
  const p = String(plan || "free").toLowerCase();

  if (p === "pro") return 100;
  if (p === "plus") return 25;

  return 5;
}

function cleanInput(value, maxLength = 2000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stripAiFormatting(text) {
  return String(text || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Here(?:'s| is).*?:\s*/i, "")
    .replace(/\*\*/g, "")
    .trim();
}

function wordsOnly(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function getBigrams(text) {
  const words = wordsOnly(text);
  const bigrams = new Set();

  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }

  return bigrams;
}

function similarityScore(original, rewritten) {
  const originalSet = getBigrams(original);
  const rewrittenSet = getBigrams(rewritten);

  if (!originalSet.size || !rewrittenSet.size) return 0;

  let overlap = 0;

  for (const item of originalSet) {
    if (rewrittenSet.has(item)) {
      overlap++;
    }
  }

  return overlap / Math.max(originalSet.size, rewrittenSet.size);
}

async function generateGeminiText(prompt) {
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 1400,
    },
  });

  return stripAiFormatting(result.response.text());
}

/* =======================================
   /me - USER INFO
======================================= */
app.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "name email plan dailyCount dailyResetAt"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = startOfToday();

    if (!user.dailyResetAt || user.dailyResetAt < today) {
      user.dailyResetAt = today;
      user.dailyCount = 0;
      await user.save();
    }

    const limitToday = getDailyLimit(user.plan);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        usedToday: user.dailyCount,
        limitToday,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================
   HUMANISER
======================================= */
function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+/g) || [text];
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function randomTone() {
  const tones = ["casual", "simple", "friendly", "natural"];
  return tones[Math.floor(Math.random() * tones.length)];
}

app.post("/humanise", authMiddleware, usageLimit, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length < 5) {
      return res.status(400).json({ message: "Invalid text" });
    }

    const sentences = splitSentences(text);
    const shuffled = shuffle(sentences);

    const rewritten = [];

    for (const sentence of shuffled) {
      const tone = randomTone();

      const response = await model.generateContent(`
Rewrite this sentence in a completely different way.

Rules:
- Change sentence structure fully
- Use ${tone} tone
- Avoid original phrasing
- Use simple human language
- Keep meaning same

Sentence:
${sentence}
      `);

      rewritten.push(response.response.text());
    }

    // 🔥 PASS 2: FLOW FIX (makes it sound natural)
    const combined = rewritten.join(" ");

    const finalPass = await model.generateContent(`
Make this text sound smooth and natural.

Rules:
- Improve flow between sentences
- Vary sentence length
- Keep it human and simple
- DO NOT make it formal

Text:
${combined}
    `);

    const humanised = finalPass.response.text();

    // 🔥 OPTIONAL: create 2nd variation (pro feature)
    const altPass = await model.generateContent(`
Rewrite this again slightly differently:

${humanised}
    `);

    const alternative = altPass.response.text();

    const saved = await Text.create({
      userId: req.user.id,
      input: text,
      output: humanised,
    });

    res.json({
      humanised,
      alternative, // 🔥 extra version
      savedId: saved._id,
      usage: req.usage,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "AI error" });
  }
});

/* =======================================
   HISTORY
======================================= */
app.get("/history", authMiddleware, async (req, res) => {
  try {
    const items = await Text.find({ userId: req.user.id }).sort({
      createdAt: -1,
    });

    res.json({ items });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ message: "Error" });
  }
});

app.delete("/history/:id", authMiddleware, async (req, res) => {
  try {
    await Text.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete history error:", err);
    res.status(500).json({ message: "Error" });
  }
});

/* =======================================
   START SERVER
======================================= */
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB error:", err.message);
    process.exit(1);
  });
