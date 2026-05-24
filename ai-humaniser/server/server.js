require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");

const connectDB = require("../config/db");
const Text = require("../models/Text");
const User = require("../models/User");
const authRoutes = require("../routes/auth");
const authMiddleware = require("./middleware/authMiddleware");
const usageLimit = require("./middleware/usageLimit");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const app = express();

/* ── STRIPE WEBHOOK (must be before json()) ── */
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const planMeta = session.metadata?.plan || "pro";
    try {
      const user = await User.findOne({ email: session.customer_email });
      if (user) { user.plan = planMeta.toLowerCase(); user.dailyCount = 0; user.dailyResetAt = startOfToday(); await user.save(); }
    } catch (err) { console.error("Webhook DB error:", err); }
  }
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    try {
      const user = await User.findOne({ stripeCustomerId: sub.customer });
      if (user) { user.plan = "free"; await user.save(); }
    } catch (err) { console.error("Subscription cancel error:", err); }
  }
  res.json({ received: true });
});

/* ── MIDDLEWARE ── */
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/auth", authRoutes);

/* ── STRIPE CHECKOUT ── */
app.post("/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const { plan = "pro" } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const PRICE_MAP = {
      basic: process.env.STRIPE_BASIC_PRICE_ID,
      pro: process.env.STRIPE_PRO_PRICE_ID,
      unlimited: process.env.STRIPE_UNLIMITED_PRICE_ID,
    };
    const priceId = PRICE_MAP[plan.toLowerCase()];
    if (!priceId) return res.status(400).json({ message: "Invalid plan" });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      metadata: { plan },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?payment=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ message: "Payment session failed" });
  }
});

/* ── CONFIRM PAYMENT ── */
app.post("/confirm-payment", authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ message: "Missing sessionId" });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return res.status(400).json({ message: "Payment not completed yet" });
    }
    const plan = session.metadata?.plan || "basic";
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.plan = plan.toLowerCase();
    user.dailyCount = 0;
    user.dailyResetAt = startOfToday();
    await user.save();
    res.json({ success: true, plan: user.plan, message: `Plan upgraded to ${user.plan}` });
  } catch (err) {
    console.error("Confirm payment error:", err);
    res.status(500).json({ message: "Could not confirm payment" });
  }
});

/* ── GEMINI ── */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

/* ── HELPERS ── */
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function getDailyLimit(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "unlimited") return 999;
  if (p === "pro") return 100;
  if (p === "basic") return 25;
  return 5;
}

function getWordLimit(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "unlimited") return 99999;
  if (p === "pro") return 1500;
  if (p === "basic") return 500;
  return 300;
}

function stripAiFormatting(text) {
  return String(text || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Here(?:'s| is).*?:\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/^(Sure|Certainly|Of course|Absolutely)[,!]?\s*/i, "")
    .trim();
}

/* ── HUMAN VARIABILITY ENGINE ── */
function injectHumanVariability(text) {
  let out = text;

  const wordSwaps = [
    [/\bfurthermore\b/gi, "on top of that"],
    [/\bmoreover\b/gi, "plus"],
    [/\badditionally\b/gi, "also"],
    [/\bconsequently\b/gi, "so"],
    [/\bnevertheless\b/gi, "still"],
    [/\bsubsequently\b/gi, "after that"],
    [/\bnotwithstanding\b/gi, "despite that"],
    [/\bin conclusion\b/gi, "all in all"],
    [/\bin summary\b/gi, "basically"],
    [/\bto summarize\b/gi, "to put it simply"],
    [/\bit is worth noting\b/gi, "worth mentioning"],
    [/\bit is important to note\b/gi, "one thing to keep in mind"],
    [/\bit should be noted\b/gi, "worth noting"],
    [/\bone must consider\b/gi, "you have to think about"],
    [/\butilize\b/gi, "use"],
    [/\butilization\b/gi, "use"],
    [/\bimplementation\b/gi, "setup"],
    [/\bfacilitate\b/gi, "help"],
    [/\bcommence\b/gi, "start"],
    [/\bterminate\b/gi, "end"],
    [/\bpurchase\b/gi, "buy"],
    [/\bindividuals\b/gi, "people"],
    [/\bprovide assistance\b/gi, "help"],
    [/\bdemonstrate\b/gi, "show"],
    [/\bascertain\b/gi, "find out"],
    [/\bencompass\b/gi, "include"],
    [/\bsubstantial\b/gi, "big"],
    [/\bnumerous\b/gi, "many"],
    [/\bsignificant\b/gi, "major"],
    [/\bsignificantly\b/gi, "a lot"],
    [/\boptimal\b/gi, "best"],
    [/\bparadigm\b/gi, "approach"],
    [/\brobust\b/gi, "strong"],
    [/\bseamlessly?\b/gi, "smoothly"],
    [/\bcutting-edge\b/gi, "latest"],
    [/\bstate-of-the-art\b/gi, "advanced"],
    [/\bgroundbreaking\b/gi, "new"],
    [/\bleverage\b/gi, "use"],
    [/\bsynergy\b/gi, "teamwork"],
    [/\bdelve\b/gi, "dig"],
    [/\btapestry\b/gi, "mix"],
    [/\bnuanced\b/gi, "complex"],
    [/\bin today's (?:fast-paced |ever-changing |modern )?world\b/gi, "these days"],
    [/\bin the realm of\b/gi, "in"],
    [/\bthe fact that\b/gi, "that"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bin order to\b/gi, "to"],
    [/\bwith regard to\b/gi, "about"],
    [/\bwith respect to\b/gi, "about"],
    [/\bprior to\b/gi, "before"],
    [/\bsubsequent to\b/gi, "after"],
    [/\ba wide range of\b/gi, "many"],
    [/\ba variety of\b/gi, "various"],
    [/\bthe majority of\b/gi, "most"],
    [/\bplays a (?:crucial|vital|key|important|pivotal) role\b/gi, "matters a lot"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bis able to\b/gi, "can"],
    [/\bwas able to\b/gi, "could"],
  ];
  for (const [pattern, replacement] of wordSwaps) {
    out = out.replace(pattern, replacement);
  }

  // Break long sentences
  out = out.replace(
    /([^.!?]{120,}?),\s+(and|but|which|so|however)\s+/g,
    (match, before, conj) => `${before}. ${conj.charAt(0).toUpperCase() + conj.slice(1)} `
  );

  // Add em-dashes
  out = out.replace(/,\s+(which (?:is|was|makes|means|allows|helps))\s+/g, " — $1 ");

  // Contractions (~60% rate)
  const contractions = [
    [/\bis not\b/g, "isn't"], [/\bare not\b/g, "aren't"], [/\bwas not\b/g, "wasn't"],
    [/\bwere not\b/g, "weren't"], [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"],
    [/\bdid not\b/g, "didn't"], [/\bcannot\b/g, "can't"], [/\bcould not\b/g, "couldn't"],
    [/\bwould not\b/g, "wouldn't"], [/\bshould not\b/g, "shouldn't"],
    [/\bhave not\b/g, "haven't"], [/\bhas not\b/g, "hasn't"], [/\bhad not\b/g, "hadn't"],
    [/\bwill not\b/g, "won't"], [/\bit is\b/g, "it's"], [/\bthat is\b/g, "that's"],
    [/\bthere is\b/g, "there's"], [/\bthey are\b/g, "they're"],
    [/\bwe are\b/g, "we're"], [/\byou are\b/g, "you're"],
  ];
  for (const [pattern, replacement] of contractions) {
    out = out.replace(pattern, (match) => Math.random() < 0.6 ? replacement : match);
  }

  // Remove passive voice
  out = out
    .replace(/\bIt can be seen that\b/gi, "Clearly,")
    .replace(/\bIt has been (?:shown|demonstrated|proven|found)\b/gi, "Research shows")
    .replace(/\bIt is (?:generally |widely |commonly |often )?believed\b/gi, "Most people think")
    .replace(/\bIt is (?:generally |widely |commonly )?accepted\b/gi, "Most people agree")
    .replace(/\bIt is (?:clear|evident|obvious) that\b/gi, "Clearly,")
    .replace(/\bThis (?:clearly |obviously )?demonstrates\b/gi, "This shows")
    .replace(/\bThis (?:clearly |obviously )?indicates\b/gi, "This means")
    .replace(/\bThis (?:clearly |obviously )?suggests\b/gi, "This hints");

  // Vary paragraph openers
  const paragraphs = out.split(/\n\n+/);
  const starterSwaps = [
    ["The main ", "Mainly, the "],
    ["The key ", "The big thing about "],
    ["The primary ", "The main "],
    ["The most important ", "What matters most is "],
    ["The purpose of this ", "This "],
    ["The goal of this ", "The aim here is to "],
  ];
  const result = paragraphs.map((para, i) => {
    if (i === 0) return para;
    let p = para;
    for (const [from, to] of starterSwaps) {
      if (p.startsWith(from)) { p = to + p.slice(from.length); break; }
    }
    return p;
  });
  return result.join("\n\n");
}

/* ── HEALTH ── */
app.get("/", (req, res) => res.send("AI Humaniser backend is running! ✦"));

/* ── /me ── */
app.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email plan dailyCount dailyResetAt");
    if (!user) return res.status(404).json({ message: "User not found" });
    const today = startOfToday();
    if (!user.dailyResetAt || user.dailyResetAt < today) {
      user.dailyResetAt = today; user.dailyCount = 0; await user.save();
    }
    res.json({ user: { id: user._id, name: user.name, email: user.email, plan: user.plan, usedToday: user.dailyCount, limitToday: getDailyLimit(user.plan), wordLimit: getWordLimit(user.plan) } });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
});

/* ── HUMANISE ── */
app.post("/humanise", authMiddleware, usageLimit, async (req, res) => {
  try {
    const { text, mode = "standard" } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({ message: "Text too short (min 5 chars)" });

    const wordLimit = getWordLimit(req.user.plan);
    const words = text.trim().split(/\s+/);
    if (words.length > wordLimit) return res.status(400).json({ message: `Word limit exceeded. Your plan allows ${wordLimit} words per request.` });

    const modePrompts = {
      standard: "natural, conversational, easy to read",
      academic: "formal but still personal — like a knowledgeable human professor",
      creative: "vivid, expressive, with personality",
      casual: "informal, like texting a smart friend",
    };
    const toneDesc = modePrompts[mode] || modePrompts.standard;
    const isPremium = ["pro", "unlimited"].includes(req.user.plan?.toLowerCase());

    const prompt1 = [
      `You are a real human who writes ${toneDesc}. Rewrite this AI text to score 0% on AI detectors.`,
      "",
      "DESTROY these AI patterns:",
      "- Uniform sentence lengths — mix very short (3-6 words) with longer ones",
      "- Perfect paragraph structure — break it up, one paragraph can be 1 sentence",
      "- Formal transitions — never use: furthermore, moreover, additionally, consequently, in conclusion",
      "- Passive voice — never use: it can be seen, it has been shown, it is worth noting",
      "- AI vocabulary — never use: utilize, individuals, demonstrate, facilitate, paradigm, robust, seamless, leverage, delve, tapestry, nuanced, cutting-edge, in today's world",
      "",
      "DO these human things:",
      "- Start 1-2 sentences with And, But, or So",
      "- Add one sentence fragment. Just one. Like: And that's the thing.",
      "- Use contractions: don't, it's, you'll, wasn't, they're, we've",
      "- Include one small personal-sounding aside like 'which honestly makes sense' or 'and that's kind of the point'",
      "- Keep ALL facts — do not add or remove information",
      "",
      "Output ONLY the rewritten text. No intro. No quotes around it.",
      "",
      "Text:",
      text,
    ].join("\n");

    const pass1Result = await model.generateContent(prompt1);
    const pass1 = stripAiFormatting(pass1Result.response.text());

    let humanised;
    if (isPremium) {
      const prompt2 = [
        `Read this text. Find any sentences still sounding AI-written and rewrite just those.`,
        "",
        "AI sentence signs: starts with 'The' + noun, uses passive voice, has formal connector at start, same length as surrounding sentences, contains: utilize/individuals/demonstrate/facilitate/moreover/furthermore/optimal/robust/leverage/seamless/paradigm/nuanced/delve/tapestry",
        "",
        `Rewrite AI-sounding sentences in ${toneDesc} language. Leave already-human sentences alone.`,
        "Output ONLY the full improved text.",
        "",
        "Text:",
        pass1,
      ].join("\n");
      const pass2Result = await model.generateContent(prompt2);
      const pass2 = stripAiFormatting(pass2Result.response.text());
      humanised = injectHumanVariability(pass2);
    } else {
      humanised = injectHumanVariability(pass1);
    }

    const saved = await Text.create({ userId: req.user.id, input: text, output: humanised, mode });
    await User.findByIdAndUpdate(req.user.id, { $inc: { dailyCount: 1 } });
    res.json({ humanised, savedId: saved._id, usage: req.usage });
  } catch (err) {
    console.error("Humanise error:", err);
    res.status(500).json({ message: "AI processing error. Please try again." });
  }
});

/* ── FILE UPLOAD (Pro & Unlimited only) ── */
app.post("/upload-file", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!["pro", "unlimited"].includes(user.plan?.toLowerCase())) {
      return res.status(403).json({ message: "File upload is available on Pro and Unlimited plans only.", upgradeRequired: true });
    }
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const { mimetype, originalname, buffer } = req.file;
    if (mimetype === "text/plain" || originalname.endsWith(".txt")) {
      const text = buffer.toString("utf-8").trim();
      if (!text) return res.status(400).json({ message: "File appears to be empty" });
      return res.json({ text, filename: originalname });
    }
    if (mimetype === "application/pdf" || originalname.endsWith(".pdf")) {
      try {
        const pdfParse = require("pdf-parse");
        const data = await pdfParse(buffer);
        const text = data.text?.trim();
        if (!text) return res.status(400).json({ message: "Could not extract text from PDF." });
        return res.json({ text, filename: originalname, pages: data.numpages });
      } catch (e) {
        return res.status(500).json({ message: "Failed to read PDF. Use a text-based PDF." });
      }
    }
    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || originalname.endsWith(".docx")) {
      try {
        const mammoth = require("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value?.trim();
        if (!text) return res.status(400).json({ message: "Could not extract text from DOCX." });
        return res.json({ text, filename: originalname });
      } catch (e) {
        return res.status(500).json({ message: "Failed to read DOCX file." });
      }
    }
    return res.status(400).json({ message: "Unsupported file type. Use .txt, .pdf, or .docx" });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "File processing failed" });
  }
});

/* ── HISTORY ── */
app.get("/history", authMiddleware, async (req, res) => {
  try {
    const items = await Text.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100);
    res.json({ items });
  } catch (err) { res.status(500).json({ message: "Error fetching history" }); }
});

app.get("/texts/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Text.findOne({ _id: req.params.id, userId: req.user.id });
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json({ item });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.delete("/texts/:id", authMiddleware, async (req, res) => {
  try {
    await Text.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.delete("/history/:id", authMiddleware, async (req, res) => {
  try {
    await Text.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

/* ── START ── */
const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`✦ Server running on http://localhost:${PORT}`)))
  .catch((err) => { console.error("DB error:", err.message); process.exit(1); });