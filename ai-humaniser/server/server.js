require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");

const connectDB = require("../config/db");
const Text = require("../models/Text");
const User = require("../models/User");
const GuestUsage = require("../models/GuestUsage");
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
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
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

// Shared retry wrapper for Gemini calls — used by both the initial humanise
// pass and the second detector-evasion pass below.
async function generateWithRetries(systemInstruction, userPrompt, temperature = 1.25) {
  const modelInstance = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });
  let result;
  const maxAttempts = 3;
  let delay = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      result = await modelInstance.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature, topP: 0.95, topK: 40 },
      });
      break;
    } catch (err) {
      const isTransient = err.status === 503 || err.status === 429 ||
        (err.message && (
          err.message.includes("503") || err.message.includes("429") ||
          err.message.toLowerCase().includes("quota") ||
          err.message.toLowerCase().includes("rate limit") ||
          err.message.toLowerCase().includes("overloaded") ||
          err.message.toLowerCase().includes("high demand") ||
          err.message.toLowerCase().includes("unavailable")
        ));
      if (isTransient && attempt < maxAttempts) {
        console.warn(`[Gemini API] Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else { throw err; }
    }
  }
  return result.response.text();
}

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

function isProOrUnlimited(plan) {
  const p = String(plan || "free").toLowerCase();
  return p === "pro" || p === "unlimited";
}

function isBasicOrAbove(plan) {
  const p = String(plan || "free").toLowerCase();
  return p === "basic" || p === "pro" || p === "unlimited";
}

// ── Optional-auth gate for AI detection ──
// Detection is available to EVERYONE — guests and every paid tier — rather
// than gated by plan. The natural limiter is each tier's existing daily
// humanise allowance (2 guest trials, 5/day free, 15/day basic, 50/day pro,
// 150/day unlimited), so Basic effectively gets a "limited" amount for free
// without a separate counter. Guests must have already used at least one
// trial (proves a real session) so this can't be hit cold with no guestId
// history.
async function canUseDetectionGate(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return { allowed: true };
    } catch {
      // fall through to guest check below
    }
  }
  const guestId = req.headers["x-guest-id"];
  if (!guestId) {
    return { allowed: false, message: "Log in, or humanise some text as a guest first, to use AI detection." };
  }
  const guest = await GuestUsage.findOne({ guestId });
  if (!guest || guest.count < 1) {
    return { allowed: false, message: "Try humanising some text first to unlock AI detection." };
  }
  return { allowed: true };
}

function stripAiFormatting(text) {
  return String(text || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Here(?:'s| is).*?:\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/^(Sure|Certainly|Of course|Absolutely)[,!]?\s*/i, "")
    .trim();
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function splitSentences(text) {
  return (String(text || "").match(/[^.!?]+[.!?]+|\S+$/g) || []).map(s => s.trim()).filter(Boolean);
}

/* ══════════════════════════════════════════════════════════
   POST-PROCESSING ENGINE — attacks all 3 detector pillars:
   1. PERPLEXITY  — swap top-probability AI words
   2. BURSTINESS  — force sentence length variation
   3. TOKEN PROB  — inject low-probability human patterns
══════════════════════════════════════════════════════════ */

/* ── Pillar 1: Perplexity swaps ── */
const PERPLEXITY_SWAPS = [
  [/\bfurthermore\b/gi, () => pick(["on top of that", "beyond that", "what's more", "and another thing"])],
  [/\bmoreover\b/gi, () => pick(["beyond this", "and beyond that", "what's more", "then there's also"])],
  [/\badditionally\b/gi, () => pick(["also", "on top of this", "plus", "and there's"])],
  [/\bconsequently\b/gi, () => pick(["so", "as a result", "because of this", "this means"])],
  [/\bnevertheless\b/gi, () => pick(["even so", "still though", "despite this", "that said"])],
  [/\bsubsequently\b/gi, () => pick(["after that", "then", "following this", "next"])],
  [/\bin conclusion\b/gi, () => pick(["all in all", "at the end of the day", "to wrap up", "when you step back"])],
  [/\bin summary\b/gi, () => pick(["basically", "in short", "to put it simply", "the bottom line is"])],
  [/\butilize\b/gi, () => pick(["use", "apply", "work with"])],
  [/\butilization\b/gi, () => pick(["use", "usage", "application"])],
  [/\bfacilitate\b/gi, () => pick(["help", "support", "make easier"])],
  [/\bdemonstrate\b/gi, () => pick(["show", "reveal", "make clear"])],
  [/\bindividuals\b/gi, () => pick(["people", "users", "students", "workers"])],
  [/\boptimal\b/gi, () => pick(["best", "ideal", "most effective"])],
  [/\bparadigm\b/gi, () => pick(["approach", "way of thinking", "framework"])],
  [/\brobust\b/gi, () => pick(["strong", "solid", "reliable"])],
  [/\bleverage\b/gi, () => pick(["use", "tap into", "take advantage of"])],
  [/\bdelve\b/gi, () => pick(["dig into", "explore", "look at"])],
  [/\bnuanced\b/gi, () => pick(["complex", "layered", "subtle"])],
  [/\bseamlessly?\b/gi, () => pick(["smoothly", "without friction", "cleanly"])],
  [/\bcutting-edge\b/gi, () => pick(["latest", "modern", "advanced"])],
  [/\bstate-of-the-art\b/gi, () => pick(["advanced", "top-of-the-line", "modern"])],
  [/\bgroundbreaking\b/gi, () => pick(["new", "novel", "innovative"])],
  [/\bsynergy\b/gi, () => pick(["teamwork", "collaboration", "combined effort"])],
  [/\bsubstantial\b/gi, () => pick(["big", "significant", "large"])],
  [/\bnumerous\b/gi, () => pick(["many", "a lot of", "plenty of", "several"])],
  [/\bin today's (?:fast-paced |modern |ever-changing )?world\b/gi, () => pick(["these days", "nowadays", "right now"])],
  [/\bin modern society\b/gi, () => pick(["today", "currently", "in recent years"])],
  [/\bdue to the fact that\b/gi, () => pick(["because", "since", "given that"])],
  [/\bin order to\b/gi, () => pick(["to", "so that"])],
  [/\bplays a (?:crucial|vital|key|important|pivotal) role\b/gi, () => pick(["matters a lot", "is central to", "directly affects"])],
  [/\bhas the ability to\b/gi, () => pick(["can", "is able to"])],
  [/\bit is worth noting\b/gi, () => pick(["notably", "importantly", "worth pointing out"])],
  [/\bit is important to note\b/gi, () => pick(["notably", "importantly"])],
  [/\bIt can be seen that\b/gi, () => "Clearly,"],
  [/\bIt has been (?:shown|demonstrated|proven|found)\b/gi, () => pick(["Research shows", "Studies reveal", "Evidence suggests"])],
  [/\bThis (?:clearly |obviously )?demonstrates\b/gi, () => pick(["This shows", "This reveals", "This makes clear"])],
  [/\bThis (?:clearly |obviously )?indicates\b/gi, () => pick(["This means", "This suggests", "This points to"])],
];

/* ── Pillar 2: Burstiness (deliberately minimal) ──
   Earlier versions mechanically split/joined sentences by regex on a fixed
   probability schedule. That's a rigid, repeatable transformation — applied
   across thousands of outputs it becomes its own detectable fingerprint,
   and it also produces awkward, sometimes-broken joins. Real sentence-length
   variation should come from Gemini actually writing varied sentences (see
   the softened prompts in humaniseText() below), not from mechanically
   chopping its output afterward. Left as a no-op passthrough so postProcess()
   doesn't need restructuring, but it does nothing. */
function injectBurstiness(text) {
  return text;
}

/* ── Pillar 3: Low-probability token injector ──
   Contractions are a genuine, natural human signal, so those stay. Earlier
   versions also mechanically rewrote paragraph openers from a fixed lookup
   table (e.g. "The main " → "Mainly, the "). That's applied identically
   across every output regardless of context — a template swap, not real
   variation — so it's been removed rather than kept as noise. */
function injectLowProbTokens(text, isAcademic = false) {
  let out = text;
  if (!isAcademic) {
    const contractions = [
      [/\bis not\b/g, "isn't"], [/\bare not\b/g, "aren't"], [/\bwas not\b/g, "wasn't"],
      [/\bwere not\b/g, "weren't"], [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"],
      [/\bdid not\b/g, "didn't"], [/\bcannot\b/g, "can't"], [/\bcould not\b/g, "couldn't"],
      [/\bwould not\b/g, "wouldn't"], [/\bshould not\b/g, "shouldn't"],
      [/\bhave not\b/g, "haven't"], [/\bhas not\b/g, "hasn't"],
      [/\bwill not\b/g, "won't"], [/\bit is\b/g, "it's"], [/\bthat is\b/g, "that's"],
      [/\bthere is\b/g, "there's"], [/\bthey are\b/g, "they're"],
      [/\bwe are\b/g, "we're"], [/\byou are\b/g, "you're"],
    ];
    for (const [pattern, replacement] of contractions) {
      out = out.replace(pattern, (match) => Math.random() < 0.65 ? replacement : match);
    }
  }
  return out;
}

/* ── Master post-processor ── */
function postProcess(text, isAcademic) {
  let out = text;
  for (const [pattern, replaceFn] of PERPLEXITY_SWAPS) {
    out = out.replace(pattern, replaceFn);
  }
  out = injectBurstiness(out);
  out = injectLowProbTokens(out, isAcademic);
  return out;
}

/* ══════════════════════════════════════════════════════════
   FEATURE 5 — AI DETECTOR SCORE
══════════════════════════════════════════════════════════ */
// ZeroGPT's detectText endpoint (hosted on RapidAPI). Returns both an overall
// AI-likelihood percentage and the list of sentences it flagged as GPT-like —
// the latter is reused by the sentence-level route below instead of making
// a second paid call. Returns null when no key is configured.
async function zeroGptDetect(text) {
  const key = process.env.ZEROGPT_API_KEY;
  if (!key) return null;
  const resp = await fetch("https://zerogpt.p.rapidapi.com/api/v1/detectText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": "zerogpt.p.rapidapi.com",
    },
    body: JSON.stringify({ input_text: text }),
  });
  if (!resp.ok) throw new Error(`ZeroGPT API error: ${resp.status}`);
  const data = await resp.json();
  const pct = data?.data?.is_gpt_generated;
  const score = typeof pct === "number" ? Math.round(pct) : null;
  const flaggedSentences = Array.isArray(data?.data?.gpt_generated_sentences)
    ? data.data.gpt_generated_sentences.map(s => String(s).trim())
    : [];
  return { score, flaggedSentences };
}

const BUZZWORD_PATTERN = /\b(furthermore|moreover|additionally|consequently|nevertheless|subsequently|utilize|facilitate|demonstrate|individuals|optimal|paradigm|robust|leverage|delve|nuanced|seamless|cutting-edge|state-of-the-art|tapestry|testament|pivotal|profound|undeniably|underscore|showcase|garner|fostering|vibrant|intricate|in conclusion|it is important to note|it is worth noting|plays a crucial role)\b/gi;
const PASSIVE_PATTERN = /\b(is|are|was|were|been|being)\s+\w+ed\b/gi;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const MIN_RELIABLE_WORDS = 50;

function extractNumbers(text) {
  return Array.from(new Set((text.match(/\d[\d,]*\.?\d*%?/g) || []).map(s => s.trim())));
}

function wordOverlapRatio(a, b) {
  const wordsOf = (s) => new Set((s.toLowerCase().match(/[a-z']+/g) || []));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersect = 0;
  for (const w of wa) if (wb.has(w)) intersect++;
  return intersect / Math.max(wa.size, wb.size);
}

function extractStyloFeatures(text) {
  const words = (text.match(/[A-Za-z']+/g) || []);
  const wordCount = Math.max(1, words.length);
  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  const typeTokenRatio = uniqueWords / wordCount;

  const sentences = splitSentences(text);
  const sentCount = Math.max(1, sentences.length);
  const lens = sentences.map(s => (s.match(/\S+/g) || []).length);
  const meanLen = lens.reduce((a, b) => a + b, 0) / sentCount;
  const variance = lens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / sentCount;
  const stdLen = Math.sqrt(variance);
  const burstinessCV = meanLen > 0 ? stdLen / meanLen : 0;

  const buzzHits = (text.match(BUZZWORD_PATTERN) || []).length;
  const buzzPer100Words = (buzzHits / wordCount) * 100;

  const passiveHits = (text.match(PASSIVE_PATTERN) || []).length;
  const passivePer100Words = (passiveHits / wordCount) * 100;

  const contractionHits = (text.match(/\b\w+'\w+\b/g) || []).length;
  const contractionPer100Words = (contractionHits / wordCount) * 100;

  return { wordCount, sentCount, typeTokenRatio, meanLen, stdLen, burstinessCV, buzzPer100Words, passivePer100Words, contractionPer100Words };
}

function heuristicDetect(text) {
  const f = extractStyloFeatures(text);

  const burstinessScore = clamp(100 - f.burstinessCV * 140, 0, 100);
  const vocabScore = clamp(100 - f.typeTokenRatio * 140, 0, 100);
  const buzzScore = clamp(f.buzzPer100Words * 18, 0, 100);
  const passiveScore = clamp(f.passivePer100Words * 12, 0, 100);
  const contractionRelief = clamp(f.contractionPer100Words * 5, 0, 35);

  const weighted =
    burstinessScore * 0.40 +
    vocabScore * 0.25 +
    buzzScore * 0.20 +
    passiveScore * 0.15 -
    contractionRelief;

  const score = Math.round(clamp(weighted, 2, 98));

  const breakdown = {
    burstiness: { value: Number(f.burstinessCV.toFixed(2)), aiSignal: Math.round(burstinessScore), note: f.burstinessCV < 0.35 ? "Low sentence-length variation (AI-like)" : "Healthy sentence-length variation" },
    vocabularyDiversity: { value: Number(f.typeTokenRatio.toFixed(2)), aiSignal: Math.round(vocabScore), note: f.typeTokenRatio < 0.55 ? "Repetitive word choice" : "Varied vocabulary" },
    buzzwordDensity: { value: Number(f.buzzPer100Words.toFixed(1)), aiSignal: Math.round(buzzScore), note: f.buzzPer100Words > 1 ? "Frequent AI-associated transition words" : "Few AI-associated transition words" },
    passiveVoice: { value: Number(f.passivePer100Words.toFixed(1)), aiSignal: Math.round(passiveScore), note: f.passivePer100Words > 1.5 ? "Notable passive-voice usage" : "Mostly active voice" },
  };

  const distanceFromMid = Math.abs(score - 50);
  const confidence = distanceFromMid >= 30 ? "High" : distanceFromMid >= 15 ? "Moderate" : "Low";

  return { score, breakdown, confidence };
}

app.post("/detect-score", async (req, res) => {
  try {
    const gate = await canUseDetectionGate(req);
    if (!gate.allowed) {
      return res.status(403).json({ message: gate.message, upgradeRequired: false });
    }
    const { text } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({ message: "Text too short to score." });

    const wordCount = (text.match(/\S+/g) || []).length;
    if (wordCount < MIN_RELIABLE_WORDS) {
      return res.json({
        score: null,
        label: "Not enough text for a reliable estimate",
        reliable: false,
        minWords: MIN_RELIABLE_WORDS,
        wordCount,
        source: "n/a",
      });
    }

    let score, breakdown = null, confidence = null;
    let source = "heuristic";
    try {
      const zeroGptResult = await zeroGptDetect(text);
      if (zeroGptResult && zeroGptResult.score !== null) { score = zeroGptResult.score; source = "zerogpt"; }
    } catch (e) {
      console.warn("ZeroGPT detect failed, falling back to heuristic:", e.message);
    }
    if (score === undefined) {
      const result = heuristicDetect(text);
      score = result.score;
      breakdown = result.breakdown;
      confidence = result.confidence;
    }

    let label = "More consistent with human-written text";
    if (score >= 70) label = "More consistent with AI-generated text";
    else if (score >= 30) label = "Mixed / uncertain signals";

    res.json({ score, label, source, breakdown, confidence, reliable: true, wordCount });
  } catch (err) {
    console.error("Detect score error:", err);
    res.status(500).json({ message: "Could not compute AI detection score." });
  }
});

function heuristicSentenceScore(sentence, allSentences) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  const lens = allSentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const deviation = Math.abs(wordCount - mean);
  const uniformityScore = Math.max(0, 40 - deviation * 4);

  const buzzwords = /\b(furthermore|moreover|additionally|consequently|nevertheless|subsequently|utilize|facilitate|demonstrate|individuals|optimal|paradigm|robust|leverage|delve|nuanced|seamless|cutting-edge|tapestry|testament|pivotal|profound|undeniably)\b/gi;
  const buzzHits = (sentence.match(buzzwords) || []).length;
  const buzzScore = Math.min(35, buzzHits * 18);

  const passivePattern = /\b(is|are|was|were|been|being)\s+\w+ed\b/gi;
  const passiveHits = (sentence.match(passivePattern) || []).length;
  const passiveScore = Math.min(15, passiveHits * 8);

  const hasContraction = /\b\w+'\w+\b/.test(sentence);
  const hasCasual = /\b(honestly|actually|really|basically|kinda|gonna|yeah|tbh|in practice|to be fair)\b/i.test(sentence);
  const humanRelief = (hasContraction ? 15 : 0) + (hasCasual ? 15 : 0);
  const startsWithAndBut = /^(and|but)\b/i.test(sentence.trim());

  const raw = uniformityScore + buzzScore + passiveScore - humanRelief - (startsWithAndBut ? 10 : 0);
  return Math.max(2, Math.min(97, Math.round(raw)));
}

app.post("/detect-score-sentences", async (req, res) => {
  try {
    const gate = await canUseDetectionGate(req);
    if (!gate.allowed) {
      return res.status(403).json({ message: gate.message, upgradeRequired: false });
    }
    const { text } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({ message: "Text too short to score." });

    const sentences = splitSentences(text);
    if (sentences.length === 0) return res.json({ sentences: [], reliable: true });

    const totalWords = (text.match(/\S+/g) || []).length;
    if (totalWords < MIN_RELIABLE_WORDS) {
      return res.json({ sentences: sentences.map(s => ({ sentence: s, score: null })), reliable: false, minWords: MIN_RELIABLE_WORDS });
    }

    // ZeroGPT doesn't return a per-sentence probability array like Sapling did —
    // it returns the overall AI-likelihood plus a list of the sentences it flagged
    // as GPT-generated. We approximate per-sentence scores from that: flagged
    // sentences get pushed toward the overall score (floored at 60), everything
    // else gets pulled down (capped at 30), so the highlight UI still lights up
    // the right passages.
    let scored = null;
    const key = process.env.ZEROGPT_API_KEY;
    if (key) {
      try {
        const result = await zeroGptDetect(text);
        if (result && result.score !== null) {
          const flagged = result.flaggedSentences;
          scored = sentences.map(s => {
            const isFlagged = flagged.some(f => f && (s.includes(f) || f.includes(s)));
            const score = isFlagged ? Math.max(result.score, 60) : Math.min(result.score, 30);
            return { sentence: s, score };
          });
        }
      } catch (e) {
        console.warn("ZeroGPT sentence-level detect failed, falling back to heuristic:", e.message);
      }
    }
    if (!scored) {
      scored = sentences.map(s => ({ sentence: s, score: heuristicSentenceScore(s, sentences) }));
    }

    res.json({ sentences: scored, reliable: true });
  } catch (err) {
    console.error("Detect sentence scores error:", err);
    res.status(500).json({ message: "Could not compute sentence-level AI scores." });
  }
});

/* ══════════════════════════════════════════════════════════
   FEATURE 6 — SENTENCE-LEVEL REWRITER (Pro/Unlimited only)
══════════════════════════════════════════════════════════ */
app.post("/rewrite-sentence", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!isProOrUnlimited(user.plan)) {
      return res.status(403).json({ message: "Sentence rewriting is available on Pro and Unlimited plans only.", upgradeRequired: true });
    }
    const { sentence, context = "", mode = "standard" } = req.body;
    if (!sentence || sentence.trim().length < 2) return res.status(400).json({ message: "No sentence provided." });

    const modelInstance = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You rewrite a single sentence so it reads naturally and human-written, in a ${mode} tone. Vary sentence structure and word choice from the original. Keep the same meaning and any facts, numbers, or names exactly. Output ONLY the rewritten sentence — no quotes, no explanation, no extra sentences.`,
    });

    const prompt = [
      context ? `Paragraph context (for tone/flow only, do not rewrite this):\n${context}\n` : "",
      `Rewrite ONLY this sentence:\n${sentence}`,
    ].join("\n");

    const result = await modelInstance.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.1, topP: 0.95, topK: 40 },
    });

    const rewritten = stripAiFormatting(result.response.text());
    res.json({ rewritten });
  } catch (err) {
    console.error("Rewrite sentence error:", err);
    res.status(500).json({ message: "Could not rewrite sentence. Please try again." });
  }
});

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
// ── Authoritative score for the retry-loop's accept/reject decision ──
// The heuristic scorer below is what generated postProcess()'s countermeasures,
// so using it to grade its own output is circular — it will always look good
// to itself. When a real ZEROGPT_API_KEY is configured, use ZeroGPT's actual
// trained-classifier score to decide whether a revision genuinely improved,
// falling back to the heuristic only when ZeroGPT is unavailable/fails.
async function getAuthoritativeScore(text) {
  try {
    const zeroGptResult = await zeroGptDetect(text);
    if (zeroGptResult && zeroGptResult.score !== null) return { score: zeroGptResult.score, source: "zerogpt" };
  } catch (e) {
    console.warn("ZeroGPT authoritative score failed, falling back to heuristic:", e.message);
  }
  return { score: heuristicDetect(text).score, source: "heuristic" };
}

async function humaniseText(text, mode = "standard") {
    const isAcademic = mode === "academic" || mode === "professional";

    const modePrompts = {
      standard: "natural, conversational, easy to read, using normal everyday words",
      professional: "professional, clear, and direct — avoiding business jargon and AI buzzwords",
      academic: "scholarly and analytical, written like an expert human academic, avoiding robotic transition words",
      creative: "vivid and expressive, using a storytelling style with rich voice",
      casual: "highly informal, like talking to a friend, using contractions and simple phrasing",
    };
    const toneDesc = modePrompts[mode] || modePrompts.standard;

    let systemInstruction = "";
    let userPrompt = "";

    // NOTE ON APPROACH: earlier versions of this prompt gave the model rigid,
    // countable rules ("every paragraph needs 1 sentence of 6-10 words, 1-2 of
    // 14-20 words, 1 of 24-35 words"). Applied identically to every request,
    // that kind of formula becomes its own detectable pattern — a different
    // fingerprint than the one it was trying to erase, not a real fix. The
    // prompts below describe what natural human writing actually looks like
    // and let the model vary rhythm organically instead of hitting a quota.
    if (isAcademic) {
      systemInstruction = `You are a specific human academic — not a template — rewriting AI-drafted text in your own authentic voice.

Real academic writing varies in rhythm because the writer's thinking varies: a claim gets a short, blunt sentence; the reasoning behind it runs longer and more layered. Don't force a length pattern — let the idea decide how long the sentence needs to be. Some paragraphs will naturally run more even, others more jagged. That inconsistency IS the human signal; don't manufacture it mechanically.

Word choice: prefer the word a specific researcher would actually reach for over the "safest" academic synonym. Vary your transitions naturally — don't lean on the same connector twice in a row, but also don't force an unusual one just to be unusual.

Voice and structure:
- Active voice reads more like a person taking ownership of a claim; passive isn't forbidden, just don't default to it.
- Avoid the most overused AI stock phrases (furthermore, moreover, it is important to note, plays a crucial role, delve into, tapestry, testament to) — not because they're banned outright, but because a real writer would rarely reach for more than one of them in a whole piece.

Non-negotiable: never alter, round, or rephrase any number, percentage, date, statistic, or citation — copy every digit and figure exactly as given. No contractions (formal register). Output ONLY the rewritten text, nothing else.`;

      userPrompt = [
        "Rewrite this academic passage in an authentic human academic voice — not a formula.",
        "Let sentence rhythm follow the ideas rather than hitting a fixed length pattern; some claims deserve one short sentence, some reasoning needs room to unfold across a longer one.",
        "Use precise, natural word choices a specific researcher would pick, and don't over-rely on stock academic transitions.",
        "Keep every citation, number, date, and statistic exactly as given — no rounding, no rephrasing of figures.",
        "No contractions. Formal register. Output only the rewritten text.",
        "",
        "Text:",
        text
      ].join("\n");
    } else {
      systemInstruction = `You are a specific human writer — with your own voice, habits, and quirks — rewriting AI-drafted text so it reads like something you actually wrote, not like a template being filled in.

Real human writing has uneven rhythm because a real person's thinking is uneven — not because every paragraph follows a short/medium/long formula. Let sentence length follow what you're actually saying: a flat statement can be short, an idea with some nuance can run longer and wind through a clause or two. Don't force a pattern; just don't let every sentence land at the same length either.

Word choice: reach for the word you'd actually use, not the safest or most "impressive" synonym. A few of the most overused AI stock phrases — furthermore, moreover, it is important to note, plays a crucial role, delve into, tapestry, testament — are worth avoiding, but this isn't a banned-word checklist to mechanically scrub; a real person just rarely reaches for more than one of them anyway.

Voice signals that read as human: natural contractions where they fit your tone, the occasional sentence that starts with "And" or "But" if it flows, a stray aside if it genuinely fits (not one bolted onto every paragraph). Use these where they feel earned, not as a quota to hit.

FACTS ARE OFF LIMITS: never alter, round, or rephrase any number, percentage, date, statistic, or name. Copy every digit and figure exactly as given — style changes are fine, factual changes are not.

TONE: ${toneDesc}
OUTPUT: Rewritten text only. No intro. No explanation.`;

      userPrompt = [
        "Rewrite this text in a natural, authentic human voice — vary sentence rhythm because the ideas call for it, not by hitting a length quota.",
        "Use word choices a real person would actually reach for, and avoid leaning on the most overused AI stock phrases (furthermore, moreover, utilize, delve, tapestry, testament, and similar).",
        "Let contractions and casual asides show up where they genuinely fit your tone, not forced into every paragraph.",
        "Keep every number, date, name, and statistic exactly as given.",
        "",
        "Text:",
        text
      ].join("\n");
    }

    const originalNumbers = extractNumbers(text);

    // ── Two independent candidates on the first pass ──
    // Rather than committing to one linear rewrite, generate two independent
    // drafts at slightly different temperatures and keep whichever scores
    // lower against the authoritative detector (falling back to the first
    // if scoring fails). This gives the model room to land on a genuinely
    // different phrasing rather than mechanically patching one draft.
    const [rawA, rawB] = await Promise.all([
      generateWithRetries(systemInstruction, userPrompt, 1.15),
      generateWithRetries(systemInstruction, userPrompt, 1.35),
    ]);
    const candidateA = postProcess(stripAiFormatting(rawA), isAcademic);
    const candidateB = postProcess(stripAiFormatting(rawB), isAcademic);

    let humanised = candidateA;
    let passesUsed = 1;
    try {
      const [scoreA, scoreB] = await Promise.all([
        getAuthoritativeScore(candidateA),
        getAuthoritativeScore(candidateB),
      ]);
      humanised = scoreB.score < scoreA.score ? candidateB : candidateA;
    } catch (e) {
      console.warn("Candidate comparison failed, keeping first draft:", e.message);
    }

    // ── Multi-pass adversarial loop ──
    // Iteratively rewrites against the AUTHORITATIVE score (ZeroGPT when
    // configured, heuristic fallback otherwise) instead of stopping after
    // one retry. Mirrors the "generate → test against detector → rewrite
    // again if still flagged" loop used by commercial humanizers. Each pass
    // is only kept if it (a) scored strictly better than the current best,
    // (b) preserved meaning (word overlap + length ratio guard), and
    // (c) didn't lose any number/date/stat that survived so far — so a
    // pass chasing a lower score can never silently corrupt the content.
    const MAX_PASSES = 5;
    const TARGET_SCORE = 35; // stop early once authoritatively below this

    try {
      let bestText = humanised;
      let bestAuth = await getAuthoritativeScore(bestText);

      for (let pass = 2; pass <= MAX_PASSES && bestAuth.score > TARGET_SCORE; pass++) {
        const breakdown = heuristicDetect(bestText).breakdown; // targeted fix instructions, not the score itself
        const problems = [];
        if (breakdown.burstiness.aiSignal > 40) {
          problems.push("- Sentence lengths are still too uniform (low burstiness). Let some sentences run short and blunt and others longer and more layered, following what each idea actually needs — don't hit a fixed word-count pattern, just avoid several sentences in a row landing at a similar length.");
        }
        if (breakdown.vocabularyDiversity.aiSignal > 40) {
          problems.push("- Vocabulary is too predictable (low perplexity). Replace common, high-probability word choices with less expected but natural synonyms, idioms, and phrasing a specific person would actually use.");
        }
        if (breakdown.buzzwordDensity.aiSignal > 20) {
          problems.push("- Still contains AI-fingerprint words/phrases (furthermore, moreover, additionally, in conclusion, it is important to note, plays a crucial role, delve, tapestry, testament, etc). Strip every one of them.");
        }
        if (breakdown.passiveVoice.aiSignal > 20) {
          problems.push("- Too much passive voice. Convert passive constructions ('it was found that', 'is considered to be') to direct, active phrasing.");
        }
        problems.push("- Restructure at least one paragraph's rhythm entirely — don't just swap words, change how the ideas connect and flow between sentences.");
        if (problems.length === 1) {
          problems.unshift("- The overall rhythm and word choice still statistically resemble machine-generated text. Rework the phrasing so it reads like a specific person wrote it under time pressure, not a polished template.");
        }

        const critiqueSystem = `You are a meticulous human editor doing another pass on a draft that a real AI-detection classifier still flags as machine-written. Fix ONLY the specific problems listed, attacking perplexity (word predictability) and burstiness (sentence-length variation) — the two statistical fingerprints detectors rely on most. Preserve the exact meaning, all facts, numbers, names, and citations — never alter a digit or figure. Do not shorten the text significantly. Output ONLY the revised passage — no preamble, no explanation.`;
        const critiquePrompt = [
          `This is rewrite pass ${pass} of ${MAX_PASSES}. A real AI detector still scores this passage as ${bestAuth.score}% AI-likely (source: ${bestAuth.source}). Specific problems to fix:`,
          "",
          problems.join("\n"),
          "",
          "Passage:",
          bestText,
        ].join("\n");

        // Slightly raise temperature each pass so it doesn't converge on the same stuck rewrite.
        const passTemp = Math.min(1.4, 1.15 + pass * 0.05);
        const revisedRaw = await generateWithRetries(critiqueSystem, critiquePrompt, passTemp);
        const revised = postProcess(stripAiFormatting(revisedRaw), isAcademic);
        const revisedAuth = await getAuthoritativeScore(revised);

        const overlap = wordOverlapRatio(bestText, revised);
        const wordsBefore = Math.max(1, (bestText.match(/\S+/g) || []).length);
        const wordsAfter = (revised.match(/\S+/g) || []).length;
        const lengthRatio = wordsAfter / wordsBefore;
        const bestMissingNumbers = originalNumbers.filter(n => !bestText.includes(n));
        const revisedMissingNumbers = originalNumbers.filter(n => !revised.includes(n));

        const scoredBetter = revisedAuth.score < bestAuth.score;
        const meaningPreserved = overlap >= 0.5 && lengthRatio >= 0.75 && lengthRatio <= 1.3;
        const noNewNumberLoss = revisedMissingNumbers.length <= bestMissingNumbers.length;

        if (scoredBetter && meaningPreserved && noNewNumberLoss) {
          bestText = revised;
          bestAuth = revisedAuth;
          passesUsed = pass;
        } else if (scoredBetter && !meaningPreserved) {
          console.warn(`Pass ${pass} scored better (${revisedAuth.score}%) but drifted too far from source — discarding, keeping pass ${passesUsed}.`);
        } else {
          console.warn(`Pass ${pass} did not improve on ${bestAuth.score}% (${bestAuth.source}) — discarding, keeping pass ${passesUsed}.`);
        }
      }

      humanised = bestText;
    } catch (e) {
      console.warn("Multi-pass humanise loop failed partway through, keeping best result so far:", e.message);
    }

    const missingNumbers = originalNumbers.filter(n => !humanised.includes(n));
    const factCheck = { numbersPreserved: missingNumbers.length === 0, missingNumbers };

  return { humanised, passesUsed, factCheck };
}

function sendGenerationError(err, res) {
  console.error("Humanise error after retries:", err);

  const isServiceUnavailable = err.status === 503 ||
    (err.message && (
      err.message.includes("503") ||
      err.message.toLowerCase().includes("service unavailable") ||
      err.message.toLowerCase().includes("high demand") ||
      err.message.toLowerCase().includes("overloaded")
    ));
  if (isServiceUnavailable) {
    return res.status(503).json({ message: "Gemini AI service is temporarily experiencing high demand. Please try again in a few seconds." });
  }

  const isQuotaExceeded = err.status === 429 ||
    (err.message && (
      err.message.includes("429") ||
      err.message.toLowerCase().includes("quota") ||
      err.message.toLowerCase().includes("rate limit") ||
      err.message.toLowerCase().includes("resource exhausted")
    ));
  if (isQuotaExceeded) {
    return res.status(429).json({ message: "Gemini API Rate Limit exceeded. Please check your Google AI Studio billing balance." });
  }

  res.status(500).json({ message: "AI processing error. Please try again." });
}

app.post("/humanise", authMiddleware, usageLimit, async (req, res) => {
  try {
    const { text, mode = "standard" } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({ message: "Text too short (min 5 chars)" });

    const wordLimit = getWordLimit(req.user.plan);
    const words = text.trim().split(/\s+/);
    if (words.length > wordLimit) return res.status(400).json({ message: `Word limit exceeded. Your plan allows ${wordLimit} words per request.` });

    const { humanised, passesUsed, factCheck } = await humaniseText(text, mode);

    const saved = await Text.create({ userId: req.user.id, input: text, output: humanised, mode });
    await User.findByIdAndUpdate(req.user.id, { $inc: { dailyCount: 1 } });
    res.json({ humanised, savedId: saved._id, usage: req.usage, passesUsed, factCheck });
  } catch (err) {
    sendGenerationError(err, res);
  }
});

const GUEST_TRY_LIMIT = 2;
const GUEST_WORD_LIMIT = 300;

app.post("/guest/humanise", async (req, res) => {
  try {
    const { text, mode = "standard" } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({ message: "Text too short (min 5 chars)" });

    const guestId = req.headers["x-guest-id"] || req.body.guestId;
    if (!guestId || typeof guestId !== "string" || guestId.length < 8) {
      return res.status(400).json({ message: "Missing guest id." });
    }

    const words = text.trim().split(/\s+/);
    if (words.length > GUEST_WORD_LIMIT) {
      return res.status(400).json({ message: `Free trial is limited to ${GUEST_WORD_LIMIT} words per request. Create a free account for higher limits.` });
    }

    let guest = await GuestUsage.findOne({ guestId });
    if (!guest) guest = await GuestUsage.create({ guestId, count: 0 });

    if (guest.count >= GUEST_TRY_LIMIT) {
      return res.status(403).json({
        message: "You've used all your free tries. Create a free account to keep going.",
        limitReached: true,
        usage: { used: guest.count, limit: GUEST_TRY_LIMIT },
      });
    }

    const { humanised, passesUsed, factCheck } = await humaniseText(text, mode);

    guest.count += 1;
    guest.lastUsedAt = new Date();
    await guest.save();

    res.json({ humanised, passesUsed, factCheck, usage: { used: guest.count, limit: GUEST_TRY_LIMIT } });
  } catch (err) {
    sendGenerationError(err, res);
  }
});

/* ── FILE UPLOAD (Pro & Unlimited only) ── */
app.post("/upload-file", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!isProOrUnlimited(user.plan)) {
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

/* ── START SERVER ── */
const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`✦ Server running on http://localhost:${PORT}`)))
  .catch((err) => { console.error("DB error:", err.message); process.exit(1); });