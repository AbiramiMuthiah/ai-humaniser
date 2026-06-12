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

/* ── DOWNGRADE TO FREE ── */
app.post("/downgrade-to-free", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.plan = "free";
    await user.save();
    console.log("User downgraded to free:", user.email);
    res.json({ success: true, plan: "free" });
  } catch (err) {
    console.error("Downgrade error:", err);
    res.status(500).json({ message: "Could not downgrade plan" });
  }
});

/* ── GEMINI ── */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/* ── HELPERS ── */
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function getDailyLimit(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "unlimited") return 150;
  if (p === "pro") return 50;
  if (p === "basic") return 15;
  return 5;
}

function getWordLimit(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "unlimited") return 1500;
  if (p === "pro") return 1200;
  if (p === "basic") return 800;
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

/* ── ACADEMIC VARIABILITY ENGINE ── */
// Rule-based post-processing for academic/professional modes
// Avoids casual language but still breaks AI detector patterns
function injectAcademicVariability(text) {
  let out = text;

  // Kill remaining AI clichés that are safe to replace in academic text
  const academicSwaps = [
    [/furthermore/gi, "beyond this"],
    [/moreover/gi, "building on this"],
    [/additionally/gi, "also"],
    [/consequently/gi, "as a result"],
    [/nevertheless/gi, "despite this"],
    [/subsequently/gi, "following this"],
    [/in conclusion/gi, "taken together"],
    [/to summarize/gi, "in brief"],
    [/it is worth noting/gi, "notably"],
    [/it is important to note/gi, "importantly"],
    [/it should be noted/gi, "notably"],
    [/it can be seen that/gi, "the data suggest that"],
    [/it has been shown/gi, "research shows"],
    [/it was found that/gi, "the study found that"],
    [/utilize/gi, "use"],
    [/utilization/gi, "use"],
    [/facilitate/gi, "support"],
    [/demonstrate/gi, "show"],
    [/individuals/gi, "people"],
    [/ascertain/gi, "determine"],
    [/commence/gi, "begin"],
    [/terminate/gi, "end"],
    [/substantial/gi, "significant"],
    [/numerous/gi, "many"],
    [/optimal/gi, "best"],
    [/paradigm/gi, "framework"],
    [/robust/gi, "strong"],
    [/leverage/gi, "use"],
    [/delve/gi, "examine"],
    [/nuanced/gi, "complex"],
    [/in today's (?:fast-paced |ever-changing |modern )?world/gi, "currently"],
    [/in modern society/gi, "in recent years"],
    [/the fact that/gi, "that"],
    [/due to the fact that/gi, "because"],
    [/in order to/gi, "to"],
    [/with regard to/gi, "regarding"],
    [/prior to/gi, "before"],
    [/subsequent to/gi, "after"],
    [/plays a (?:crucial|vital|key|important|pivotal) role/gi, "is central to"],
    [/has the ability to/gi, "can"],
    [/is able to/gi, "can"],
  ];

  for (const [pattern, replacement] of academicSwaps) {
    out = out.replace(pattern, replacement);
  }

  // Break sentences over 200 chars at natural conjunction points
  out = out.replace(
    /([^.!?]{160,}?),\s+(and|but|which|while|although|however)\s+/g,
    (match, before, conj) => {
      const conjMap = { and: "Additionally,", but: "However,", which: "This", while: "Meanwhile,", although: "Although", however: "However," };
      return `${before}. ${conjMap[conj] || conj.charAt(0).toUpperCase() + conj.slice(1)} `;
    }
  );

  // Add em-dash for academic emphasis (replace some commas before "which is/was")
  out = out.replace(/,\s+(which (?:is|was|remains|represents|reflects))\s+/g, " — $1 ");

  // Remove passive voice patterns
  out = out
    .replace(/It can be seen that/gi, "The evidence suggests that")
    .replace(/It has been (?:shown|demonstrated|proven|found)/gi, "Research has shown")
    .replace(/It is (?:generally |widely |commonly )?believed/gi, "Scholars generally argue")
    .replace(/It is (?:clear|evident|obvious) that/gi, "Clearly,")
    .replace(/This (?:clearly |obviously )?demonstrates/gi, "This shows")
    .replace(/This (?:clearly |obviously )?indicates/gi, "This suggests")
    .replace(/This (?:clearly |obviously )?suggests/gi, "The data suggest");

  // Vary paragraph openers from AI defaults
  const paragraphs = out.split(/\n\n+/);
  const academicStarters = [
    ["The main ", "A primary "],
    ["The key ", "A central "],
    ["The primary ", "One important "],
    ["The most important ", "Among the most significant "],
    ["The purpose ", "The aim "],
    ["The results ", "These findings "],
    ["The study ", "This research "],
  ];

  const result = paragraphs.map((para, i) => {
    if (i === 0) return para;
    let p = para;
    for (const [from, to] of academicStarters) {
      if (p.startsWith(from)) { p = to + p.slice(from.length); break; }
    }
    return p;
  });

  return result.join("\n\n");
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

    const isAcademic = mode === "academic" || mode === "professional";
    const isPremium = ["pro", "unlimited"].includes(req.user.plan?.toLowerCase());

    // toneDesc used in prompts — must be defined before prompt1
    const modePrompts = {
      standard: "natural, conversational, easy to read",
      professional: "professional and polished — suitable for reports and formal documents",
      academic: "formal academic — suitable for university assignments and research",
      creative: "vivid, expressive, with personality",
      casual: "informal, like texting a smart friend",
    };
    const toneDesc = modePrompts[mode] || modePrompts.standard;

    // Academic mode uses a completely different strategy:
    // preserve formal vocabulary, keep structure, only change AI-detector patterns
    const prompt1 = isAcademic ? [
      `You are a human ${mode === "professional" ? "professional" : "student"} who wrote this for a ${mode === "professional" ? "workplace report" : "university assignment"}. Your writing is natural but academic.`,
      "",
      "Rewrite this AI-generated text so it scores 0% on Quillbot, Turnitin, and GPTZero — while staying fully academic.",
      "",
      "The #1 AI detector signal: every sentence has the same rhythm and length. You MUST break this.",
      "",
      "REQUIRED — do ALL of these:",
      "1. VARY sentence length dramatically — mix short (5-8 words), medium (12-18 words), and long (20-30 words) sentences",
      "2. START paragraphs differently — not every paragraph starts with 'The' or 'This'. Use: 'Notably,', 'As such,', 'When examining...', 'A key concern here is...', 'What emerges from this...'",
      "3. BREAK perfect 3-sentence paragraph structure — some paragraphs 1-2 sentences, some 5-6",
      "4. REPLACE these AI clichés completely:",
      "   - 'it is worth noting' → 'notably' or 'importantly'",
      "   - 'furthermore' / 'moreover' → 'beyond this' or 'building on this'",
      "   - 'in conclusion' → 'taken together' or 'overall'",
      "   - 'it can be seen that' → state the observation directly",
      "   - 'in today\'s world' / 'in modern society' → 'currently' or 'in recent years'",
      "   - 'plays a crucial/vital role' → 'is central to' or 'directly affects'",
      "   - 'it is important to note' → just say it directly",
      "   - 'individuals' → 'people', 'students', or 'researchers' (be specific)",
      "   - 'utilize' → 'use'",
      "   - 'demonstrate' → 'show' or 'reveal'",
      "   - 'Consequently,' at sentence start → rephrase the whole sentence",
      "   - 'Therefore,' at sentence start → rephrase or use 'As a result,'",
      "5. USE one em-dash (—) somewhere for natural emphasis",
      "6. CONVERT passive voice: 'it has been shown' → 'research shows', 'it was found' → 'the study found'",
      "7. MAKE AT LEAST ONE paragraph just 1-2 sentences long",
      "",
      "KEEP:",
      "- Third-person voice — no 'I' or 'we'",
      "- No contractions — academic writing avoids these",
      "- All facts, data, statistics exactly as stated",
      "- Any citations exactly as they appear",
      "- Formal register — no slang",
      "",
      "Output ONLY the rewritten text. No intro. No explanation.",
      "",
      "Text:",
      text,
    ].join("\n") : [
      "You are a real human writer. Rewrite this AI text to score 0% on AI detectors.",
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
      "- Include one small personal-sounding aside",
      "- Keep ALL facts — do not add or remove information",
      "",
      "Output ONLY the rewritten text. No intro. No quotes.",
      "",
      "Text:",
      text,
    ].join("\n");

    const pass1Result = await model.generateContent(prompt1);
    const pass1 = stripAiFormatting(pass1Result.response.text());

    // ── PASS 2: targeted sentence-level fix ──────────────────────
    const prompt2Lines = isAcademic ? [
      "You are a human editor reviewing a university assignment draft.",
      "Read each sentence. If it sounds like it was written by AI, rewrite just that sentence.",
      "",
      "Signs a sentence is AI-written (fix these):",
      "- Starts with: 'Furthermore,', 'Moreover,', 'Additionally,', 'Consequently,', 'Nevertheless,', 'Subsequently,'",
      "- Uses: 'it is worth noting', 'it should be noted', 'it is important to note', 'it can be seen that'",
      "- Uses: 'plays a crucial/vital/pivotal role', 'in today\'s world', 'in modern society'",
      "- Every sentence in a paragraph is the same length",
      "- Passive voice: 'has been shown', 'can be seen', 'it was found'",
      "",
      "When rewriting:",
      "- Keep academic register — no contractions, no slang",
      "- Vary the sentence length from surrounding sentences",
      "- Start the sentence differently from how AI would start it",
      "- Keep all facts exactly the same",
      "",
      "Output ONLY the full corrected text.",
      "",
      "Text:",
      pass1,
    ] : [
      "Read this text carefully. Find every sentence that still sounds AI-generated and rewrite just those sentences.",
      "",
      "AI sentence red flags:",
      "- Formal connectors at start: 'Furthermore,', 'Moreover,', 'Additionally,', 'Consequently,'",
      "- Clichés: 'it is worth noting', 'plays a crucial role', 'in today\'s fast-paced world'",
      "- Passive: 'it has been shown', 'it can be seen', 'it was found that'",
      "- Same length as all surrounding sentences",
      "- Sounds like a textbook or corporate memo",
      "",
      "Rewrite AI sentences only. Leave human-sounding ones alone.",
      `Keep tone: ${toneDesc}.`,
      "Output ONLY the full improved text.",
      "",
      "Text:",
      pass1,
    ];

    const pass2Result = await model.generateContent(prompt2Lines.join("\n"));
    const pass2 = stripAiFormatting(pass2Result.response.text());

    // ── PASS 3: statistical variability injection ─────────────────
    // This breaks the uniform perplexity/burstiness patterns detectors measure
    const prompt3Lines = [
      "You are rewriting a piece of text to make it sound MORE like a human wrote it.",
      "",
      "Do these specific things to the text below:",
      "1. Find the 2-3 LONGEST sentences and split each into two shorter ones",
      "2. Find the 2-3 SHORTEST sentences and merge each with the next sentence",
      "3. Add ONE parenthetical aside somewhere — like (which is particularly relevant here) or (a finding consistent with earlier research)",
      isAcademic
        ? "4. Change one sentence to start with a number: 'Three key factors...' or 'Two distinct patterns...'"
        : "4. Add one dash (—) in a sentence for natural emphasis",
      "5. Make sure no two consecutive sentences start with the same word",
      "",
      "Do NOT change the meaning. Do NOT add new facts.",
      isAcademic
        ? "Keep academic register — no contractions."
        : "Keep the same tone as the existing text.",
      "Output ONLY the rewritten text.",
      "",
      "Text:",
      pass2,
    ];

    const pass3Result = await model.generateContent(prompt3Lines.join("\n"));
    const pass3 = stripAiFormatting(pass3Result.response.text());

    // ── Final rule-based injection ────────────────────────────────
    const humanised = isAcademic
      ? injectAcademicVariability(pass3)
      : injectHumanVariability(pass3);

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