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

/* ── Pillar 2: Burstiness injector ── */
function injectBurstiness(text) {
  const paragraphs = text.split(/\n\n+/);
  return paragraphs.map(para => {
    if (!para.trim()) return para;
    const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
    if (sentences.length < 3) return para;
    const result = [];
    let i = 0;
    while (i < sentences.length) {
      const s = sentences[i].trim();
      const wordCount = s.split(/\s+/).length;
      if (wordCount >= 15 && wordCount <= 25 && i < sentences.length - 1) {
        const r = Math.random();
        if (r < 0.3) {
          const split = s.replace(
            /^(.{60,}?),\s+(and|but|which|so|while|although|however)\s+/i,
            (m, before, conj) => {
              const conjMap = { and: "And", but: "But", which: "This", so: "So", while: "Meanwhile,", although: "Although", however: "However," };
              return before + '. ' + (conjMap[conj.toLowerCase()] || conj.charAt(0).toUpperCase() + conj.slice(1)) + ' ';
            }
          );
          result.push(split);
        } else if (r < 0.5 && i + 1 < sentences.length) {
          const next = sentences[i + 1].trim();
          if (next.split(/\s+/).length < 12) {
            const connector = pick([" — ", "; ", ", and ", ", but "]);
            result.push(s.replace(/[.!?]+$/, '') + connector + next.charAt(0).toLowerCase() + next.slice(1));
            i += 2; continue;
          } else { result.push(s); }
        } else { result.push(s); }
      } else { result.push(s); }
      i++;
    }
    return result.join(' ');
  }).join('\n\n');
}

/* ── Pillar 3: Low-probability token injector ── */
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
  // Vary paragraph openers
  const paragraphs = out.split(/\n\n+/);
  const starters = isAcademic
    ? [["The results ", "These findings "], ["The study ", "This research "], ["The data ", "These data "], ["The main ", "A primary "], ["The key ", "A central "]]
    : [["The main ", "Mainly, the "], ["The key ", "One key "], ["The primary ", "A primary "], ["The most important ", "What matters most is "]];
  const result = paragraphs.map((para, idx) => {
    if (idx === 0) return para;
    let p = para;
    for (const [from, to] of starters) {
      if (p.startsWith(from)) { p = to + p.slice(from.length); break; }
    }
    return p;
  });
  return result.join('\n\n');
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
async function saplingDetect(text) {
  const key = process.env.SAPLING_API_KEY;
  if (!key) return null;
  const resp = await fetch("https://api.sapling.ai/api/v1/aidetect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, text }),
  });
  if (!resp.ok) throw new Error(`Sapling API error: ${resp.status}`);
  const data = await resp.json();
  const score = typeof data.score === "number" ? Math.round(data.score * 100) : null;
  return score;
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
      const saplingScore = await saplingDetect(text);
      if (saplingScore !== null) { score = saplingScore; source = "sapling"; }
    } catch (e) {
      console.warn("Sapling detect failed, falling back to heuristic:", e.message);
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

    let scored = null;
    const key = process.env.SAPLING_API_KEY;
    if (key) {
      try {
        const resp = await fetch("https://api.sapling.ai/api/v1/aidetect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, text, score_sentences: true }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.sentence_scores) && data.sentence_scores.length === sentences.length) {
            scored = sentences.map((s, i) => ({ sentence: s, score: Math.round(data.sentence_scores[i] * 100) }));
          }
        }
      } catch (e) {
        console.warn("Sapling sentence-level detect failed, falling back to heuristic:", e.message);
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

    if (isAcademic) {
      systemInstruction = `You are a human academic writer rewriting AI-generated text to pass Turnitin and GPTZero AI detection.

WHAT DETECTORS MEASURE — attack all three:

1. BURSTINESS (most important for academic):
Academic AI text is extremely uniform — every sentence is 18-22 words. Real academics vary dramatically.
MANDATORY pattern per paragraph:
- 1 short analytical punch (6-10 words): "This finding challenges prior assumptions."
- 1-2 medium explanatory sentences (14-20 words)  
- 1 long complex argument (24-35 words with subordinate clauses)
NEVER allow 3+ sentences of similar length.

2. PERPLEXITY — use unexpected academic word choices:
- Instead of "demonstrate" → "show" or "reveal" or "confirm"
- Instead of "utilize" → "use" or "apply" or "employ"
- Instead of "significant" → "notable" or "marked" or "considerable"
- Instead of "it has been shown that" → "research confirms" or "studies show" or "evidence points to"
- Instead of "in conclusion" → "taken together" or "overall" or "in sum"
- Instead of "furthermore" → "beyond this" or "building on this" or "relatedly"
- Instead of "consequently" → "as a result" or "this led to" or "because of this"

3. ACTIVE VOICE — passive voice = low perplexity score:
- "it was found that X" → "the study found X"
- "it is believed that" → "scholars argue" or "researchers suggest"
- "it has been shown" → "evidence shows" or "data confirm"

STRICT RULES:
- No contractions (formal register)
- NEVER alter, round, or rephrase any number, percentage, date, statistic, or citation — copy every digit and figure exactly as given in the source text
- No em-dashes or en-dashes
- No AI buzzwords: furthermore, moreover, additionally, consequently, utilize, facilitate, demonstrate, individuals, paradigm, robust, leverage, delve, nuanced, tapestry, testament, pivotal
- Output ONLY the rewritten text`;

      userPrompt = [
        "Rewrite this academic text to score below 20% on Turnitin and GPTZero AI detectors.",
        "",
        "MANDATORY burstiness pattern (count words per sentence):",
        "- Every paragraph must have: 1 short sentence (6-10 words) + 1-2 medium sentences + 1 long sentence (24-35 words)",
        "- If you find 3 consecutive sentences between 15-22 words, you MUST break the pattern",
        "",
        "MANDATORY perplexity boosters:",
        "- Replace every instance of: furthermore, moreover, consequently, utilize, demonstrate, individuals, it has been shown, it is believed, it was found",
        "- Convert at least 2 passive voice constructions to active voice per paragraph",
        "- Use at least 1 unexpected transition per paragraph (not: therefore, thus, hence)",
        "",
        "Keep all citations, data, and arguments exactly accurate.",
        "No contractions. Formal register only.",
        "Output ONLY the rewritten text.",
        "",
        "Text:",
        text
      ].join("\n");
    } else {
      systemInstruction = `You are a human editor rewriting AI text to sound like a real person wrote it.

YOUR ONLY JOB: Make the text score below 20% on AI detectors. You do this by attacking the three things detectors measure: perplexity, burstiness, and token probability.

BURSTINESS RULES (most important):
- Count the words in each sentence. If 3 or more consecutive sentences are between 12-22 words, you MUST break this pattern.
- After every 2-3 medium sentences, add either: one very short sentence (3-6 words) OR one long sentence (25-35 words).
- Example bad (AI): "Technology has changed how we work. It affects many aspects of daily life. People use it every day."
- Example good (human): "Technology changed everything. It now affects how we work, how we learn, how we communicate, and even how we rest at night. Crazy, right?"

PERPLEXITY RULES (second most important):
- Replace predictable word choices with unexpected ones.
- Instead of "significant" use "real" or "actual" or "pretty big"
- Instead of "demonstrate" use "show" or "prove"  
- Instead of "obtain" use "get"
- Instead of "sufficient" use "enough"
- Add one unexpected word or phrase per paragraph that a detector would not predict.

TOKEN PROBABILITY RULES:
- Use contractions: don't, it's, can't, won't, they're, you'll
- Start 1-2 sentences with "And" or "But" — humans do this, AI avoids it
- Add one casual aside per paragraph like "honestly", "actually", "in practice", or "to be fair"
- Use simple words over complex ones everywhere possible

BANNED WORDS (zero tolerance): furthermore, moreover, additionally, consequently, nevertheless, subsequently, utilize, facilitate, demonstrate, individuals, optimal, paradigm, robust, leverage, delve, nuanced, seamless, cutting-edge, tapestry, testament, beacon, pivotal, underscore, showcase, garner, fostering, vibrant, intricate

FACTS ARE OFF LIMITS: Never alter, round, or rephrase any number, percentage, date, statistic, name, or citation. Copy every digit and figure exactly as given — style changes are fine, factual changes are not.

TONE: ${toneDesc}
OUTPUT: Rewritten text only. No intro. No explanation.`;

      userPrompt = [
        "Rewrite this text so it scores below 20% on AI detectors.",
        "",
        "MANDATORY sentence length pattern — count words carefully:",
        "- Short sentence (3-6 words): at least 2 per paragraph",  
        "- Medium sentence (12-20 words): 2-3 per paragraph",
        "- Long sentence (22-35 words): at least 1 per paragraph",
        "- NEVER have 3+ sentences of similar length in a row",
        "",
        "MANDATORY human signals:",
        "- Use contractions: don't, it's, can't, won't",
        "- Start at least 1 sentence with 'And' or 'But'",
        "- Add 1 casual word per paragraph: honestly / actually / really / in practice",
        "- Use simple vocabulary — if a simpler word exists, use it",
        "",
        "ZERO TOLERANCE banned words: furthermore, moreover, additionally, consequently, utilize, facilitate, demonstrate, individuals, optimal, paradigm, robust, leverage, delve, nuanced, seamless, tapestry, testament, pivotal",
        "",
        "Text:",
        text
      ].join("\n");
    }

    const rawText = await generateWithRetries(systemInstruction, userPrompt, 1.25);

    const originalNumbers = extractNumbers(text);

    const raw = stripAiFormatting(rawText);
    let humanised = postProcess(raw, isAcademic);
    let passesUsed = 1;

    try {
      const preCheck = heuristicDetect(humanised);
      if (preCheck.score >= 30) {
        const problems = [];
        if (preCheck.breakdown.burstiness.aiSignal > 45) {
          problems.push("- Sentence lengths are still too uniform. Aggressively vary rhythm: mix short punchy sentences (5-8 words) with longer, complex ones (25+ words). Never allow 3 sentences of similar length in a row.");
        }
        if (preCheck.breakdown.vocabularyDiversity.aiSignal > 45) {
          problems.push("- Word choice is repetitive. Replace repeated words with varied, natural alternatives — but never sacrifice meaning for a fancier word.");
        }
        if (preCheck.breakdown.buzzwordDensity.aiSignal > 25) {
          problems.push("- Still contains AI-associated stock phrases (furthermore, moreover, additionally, in conclusion, it is important to note, plays a crucial role, etc). Remove every one of them.");
        }
        if (preCheck.breakdown.passiveVoice.aiSignal > 25) {
          problems.push("- Too much passive voice. Convert passive constructions ('it was found that', 'is considered to be') to direct active voice.");
        }
        if (problems.length === 0) {
          problems.push("- The overall rhythm and word choice still read as machine-generated. Rework the phrasing so it sounds like a specific person wrote it, not a template.");
        }

        const critiqueSystem = `You are a meticulous human copy-editor doing a second pass on a draft that still reads as AI-written. Fix ONLY the specific problems listed. Preserve the exact meaning, all facts, numbers, names, and citations — never alter a digit or figure. Do not shorten the text significantly. Output ONLY the revised passage — no preamble, no explanation.`;
        const critiquePrompt = [
          "This passage still shows signs of AI-generated writing. Specific problems to fix:",
          "",
          problems.join("\n"),
          "",
          "Passage:",
          humanised,
        ].join("\n");

        const revisedRaw = await generateWithRetries(critiqueSystem, critiquePrompt, 1.15);
        const revised = postProcess(stripAiFormatting(revisedRaw), isAcademic);
        const postCheck = heuristicDetect(revised);

        const overlap = wordOverlapRatio(humanised, revised);
        const wordsBefore = Math.max(1, (humanised.match(/\S+/g) || []).length);
        const wordsAfter = (revised.match(/\S+/g) || []).length;
        const lengthRatio = wordsAfter / wordsBefore;
        const pass1MissingNumbers = originalNumbers.filter(n => !humanised.includes(n));
        const revisedMissingNumbers = originalNumbers.filter(n => !revised.includes(n));

        const scoredBetter = postCheck.score < preCheck.score;
        const meaningPreserved = overlap >= 0.5 && lengthRatio >= 0.75 && lengthRatio <= 1.3;
        const noNewNumberLoss = revisedMissingNumbers.length <= pass1MissingNumbers.length;

        if (scoredBetter && meaningPreserved && noNewNumberLoss) {
          humanised = revised;
          passesUsed = 2;
        } else if (scoredBetter && !meaningPreserved) {
          console.warn("Second humanise pass scored better but drifted too far from the source (overlap/length check failed) — keeping first-pass result.");
        }
      }
    } catch (e) {
      console.warn("Second humanise pass failed, keeping first-pass result:", e.message);
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