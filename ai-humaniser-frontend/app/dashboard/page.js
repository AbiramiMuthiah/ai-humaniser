"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "../../lib/api";


function planLimitFallback(plan) {
  const p = (plan || "FREE").toUpperCase();
  if (p === "UNLIMITED") return 150;
  if (p === "PRO") return 50;
  if (p === "BASIC") return 15;
  return 5;
}

function makeTitle(input) {
  const t = String(input || "").trim().replace(/\s+/g, " ");
  if (!t) return "Untitled";
  return t.length > 42 ? t.slice(0, 42) + "…" : t;
}

// Rough estimate of how long a humanise call will take, based on word count.
// Tuned around a ~6s floor plus ~0.09s per word, capped so the UI stays sane.
function estimateDuration(wordCount) {
  const est = 6 + wordCount * 0.09;
  return Math.max(6, Math.min(45, Math.round(est)));
}

// FEATURE 3: progress steps shown while a humanise request is in flight.
// Each step activates once elapsed time crosses its threshold (as a % of the estimate).
const PROGRESS_STEPS = [
  { label: "Rewriting structure…", at: 0 },
  { label: "Refining sentences…", at: 0.35 },
  { label: "Polishing output…", at: 0.7 },
];

function splitIntoSentences(text) {
  const matches = String(text || "").match(/[^.!?]+[.!?]+|\S+$/g) || [];
  return matches.map((s) => s.trim()).filter(Boolean);
}

// ✅ FIX 2: Inline copy button that shows "Copied!" in place, with fallback support for non-HTTPS/insecure contexts
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={{
        padding: "4px 12px", borderRadius: 8,
        border: copied ? "1px solid rgba(125,239,160,0.4)" : "1px solid rgba(255,255,255,0.12)",
        background: copied ? "rgba(125,239,160,0.12)" : "rgba(255,255,255,0.06)",
        color: copied ? "#7defa0" : "rgba(255,255,255,0.8)",
        fontSize: 12, cursor: "pointer", fontWeight: 700,
        transition: "all 0.2s", minWidth: 58,
      }}
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch((err) => {
              console.error("Failed to copy text using navigator.clipboard: ", err);
            });
        } else {
          // Fallback to older document.execCommand for insecure (HTTP) contexts
          try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            // Place outside the visible area and keep it fixed
            textArea.style.position = "fixed";
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.width = "2em";
            textArea.style.height = "2em";
            textArea.style.padding = "0";
            textArea.style.border = "none";
            textArea.style.outline = "none";
            textArea.style.boxShadow = "none";
            textArea.style.background = "transparent";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand("copy");
            document.body.removeChild(textArea);
            if (successful) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } else {
              console.error("Fallback copying was unsuccessful");
            }
          } catch (err) {
            console.error("Failed to copy text using fallback method: ", err);
          }
        }
      }}
    >
      {copied ? "✓ Copied!" : "Copy"}
    </button>
  );
}

// FEATURE 5 + 6 combined: auto AI-score + highlighted click-to-rewrite.
// Runs automatically whenever a fresh humanised result comes in (Pro/Unlimited only).
// High-AI sentences get a red highlight, borderline ones amber, clean ones no highlight.
// Clicking any sentence rewrites it in place and re-scores.
function AiHighlightPanel({ humanText, setHumanText, canUse, canRewrite, mode, router, autoToken }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [overallScore, setOverallScore] = useState(null);
  const [overallLabel, setOverallLabel] = useState("");
  const [reliable, setReliable] = useState(true);
  const [sentenceScores, setSentenceScores] = useState([]); // [{sentence, score}]
  const [rewritingIdx, setRewritingIdx] = useState(null);
  const requestIdRef = useRef(0); // guards against a stale/slow response overwriting a newer one

  async function runDetection(text) {
    if (!canUse || !text || text.trim().length < 5) return;
    const myRequestId = ++requestIdRef.current;
    setErr("");
    setLoading(true);
    try {
      const [overallRes, sentRes] = await Promise.all([
        api.post("/detect-score", { text }),
        api.post("/detect-score-sentences", { text }),
      ]);
      // If a newer request has started since this one fired, drop this result.
      if (myRequestId !== requestIdRef.current) return;
      setOverallScore(overallRes.data?.score ?? null);
      setOverallLabel(overallRes.data?.label || "");
      setReliable(overallRes.data?.reliable !== false);
      setSentenceScores(sentRes.data?.sentences || []);
    } catch (e) {
      if (myRequestId !== requestIdRef.current) return;
      const status = e?.response?.status;
      setErr(status === 403 ? "AI scoring is a Pro/Unlimited feature." : (e?.response?.data?.message || "Could not score this text."));
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }

  // Auto-run the moment a fresh humanised result arrives.
  useEffect(() => {
    if (canUse && humanText && autoToken) {
      runDetection(humanText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoToken]);

  async function rewriteAt(idx) {
    if (!canRewrite) {
      setErr("Click-to-rewrite is a Pro/Unlimited feature. AI detection scoring is included in your Basic plan.");
      return;
    }
    setErr("");
    const items = sentenceScores.length ? sentenceScores.map(x => x.sentence) : splitIntoSentences(humanText);
    const target = items[idx];
    if (!target) return;
    setRewritingIdx(idx);
    try {
      const context = items.slice(Math.max(0, idx - 1), idx + 2).join(" ");
      const res = await api.post("/rewrite-sentence", { sentence: target, context, mode });
      const rewritten = res.data?.rewritten;
      if (rewritten) {
        const next = items.slice();
        next[idx] = rewritten;
        const joined = next.join(" ");
        setHumanText(joined);
        // Re-score the updated text so the highlight clears/updates for this sentence.
        runDetection(joined);
      }
    } catch (e) {
      const status = e?.response?.status;
      setErr(status === 403 ? "Sentence rewriting is a Pro/Unlimited feature." : (e?.response?.data?.message || "Rewrite failed."));
    } finally {
      setRewritingIdx(null);
    }
  }

  if (!humanText) return null;

  if (!canUse) {
    return (
      <div className="analysisCard">
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Basic, Pro, and Unlimited plans auto-score this output and highlight the sentences that still read as AI.
        </span>
        <button className="btnSmall" onClick={() => router.push("/pricing")}>🔒 Upgrade</button>
      </div>
    );
  }

  const overallColor =
    overallScore === null ? "rgba(255,255,255,0.6)" :
    overallScore >= 70 ? "#ff8a80" :
    overallScore >= 35 ? "#ffd166" : "#7defa0";

  // Use scored sentences if available, otherwise plain split (before first score comes back).
  const displaySentences = sentenceScores.length
    ? sentenceScores
    : splitIntoSentences(humanText).map((s) => ({ sentence: s, score: null }));

  return (
    <div className="analysisPanel">
      {/* Score header — left-to-right layout: label, big number, passage below spans full width */}
      <div className="analysisHeader">
        <div className="analysisHeaderLeft">
          <span className="analysisTitle">AI Detection</span>
          {loading ? (
            <span className="analysisMuted">Scanning…</span>
          ) : overallScore !== null && reliable ? (
            <>
              <span className="analysisBigScore" style={{ color: overallColor }}>{overallScore}%</span>
              <span className="analysisMuted">AI likelihood — {overallLabel}</span>
              <span className="analysisDisclaimer">Directional estimate, not proof of authorship</span>
            </>
          ) : !reliable ? (
            <span className="analysisMuted">Not enough text for a reliable estimate — add more content and recheck</span>
          ) : null}
        </div>
        <button className="btnSmall" onClick={() => runDetection(humanText)} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
          {loading ? "Scanning…" : "Recheck"}
        </button>
      </div>

      {/* Highlighted passage — full width */}
      <div className="highlightBox">
        {displaySentences.map((item, idx) => {
          const s = item.sentence;
          const score = item.score;
          const isHigh = score !== null && score >= 60;
          const isMid = score !== null && score >= 35 && score < 60;
          const bg = isHigh
            ? "rgba(255,90,90,0.22)"
            : isMid
              ? "rgba(255,209,102,0.16)"
              : "transparent";
          const underline = isHigh
            ? "1px solid rgba(255,120,120,0.55)"
            : isMid
              ? "1px dashed rgba(255,209,102,0.5)"
              : "1px dashed rgba(139,120,255,0.25)";
          return (
            <span
              key={idx}
              onClick={() => rewritingIdx === null && rewriteAt(idx)}
              title={score !== null ? `${score}% AI-likely — click to rewrite` : "Click to rewrite this sentence"}
              style={{
                cursor: rewritingIdx === null ? "pointer" : "default",
                padding: "1px 3px",
                borderRadius: 5,
                marginRight: 4,
                background: rewritingIdx === idx ? "rgba(139,120,255,0.3)" : bg,
                opacity: rewritingIdx !== null && rewritingIdx !== idx ? 0.5 : 1,
                borderBottom: underline,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { if (rewritingIdx === null && !isHigh && !isMid) e.currentTarget.style.background = "rgba(139,120,255,0.14)"; }}
              onMouseLeave={(e) => { if (rewritingIdx !== idx) e.currentTarget.style.background = bg; }}
            >
              {rewritingIdx === idx ? "Rewriting…" : s}{" "}
            </span>
          );
        })}
      </div>

      <div className="legendRow">
        <span><span className="legendDot" style={{ background: "rgba(255,90,90,0.5)" }} />High AI — click to rewrite</span>
        <span><span className="legendDot" style={{ background: "rgba(255,209,102,0.4)" }} />Mixed</span>
        <span><span className="legendDot" style={{ background: "rgba(255,255,255,0.1)" }} />Human-like</span>
      </div>

      {err && <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,150,150,0.9)" }}>{err}</div>}
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);

  const [plan, setPlan] = useState("FREE");
  const [usedToday, setUsedToday] = useState(0);
  const [limitToday, setLimitToday] = useState(planLimitFallback("FREE"));

  const [aiText, setAiText] = useState("");
  const [humanText, setHumanText] = useState("");

  const [history, setHistory] = useState([]);
  const [loadingHumanise, setLoadingHumanise] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [toast, setToast] = useState(""); // small toast
  const toastTimerRef = useRef(null);

  const [error, setError] = useState("");
  const [factCheck, setFactCheck] = useState(null); // { numbersPreserved, missingNumbers }

  // Guest trial — lets people use the tool before creating an account.
  const [isGuest, setIsGuest] = useState(false);
  const [guestId, setGuestId] = useState(null);
  const [guestUsed, setGuestUsed] = useState(0);
  const GUEST_TRY_LIMIT = 5;

  const [historyOpen, setHistoryOpen] = useState(true);

  // 3-dot menu state
  const [menuOpenId, setMenuOpenId] = useState(null);

  // File upload
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState("standard");
  const aiTextareaRef = useRef(null);
  const humanTextareaRef = useRef(null);

  // FEATURE 1 + 3: timer + progress steps while humanising
  const [elapsed, setElapsed] = useState(0);
  const [estimatedTotal, setEstimatedTotal] = useState(10);
  const elapsedTimerRef = useRef(null);

  // FEATURE 5 + 6: bumped each time a fresh humanise result lands, to
  // trigger the AI-score/highlight panel to auto-run once per result.
  const [autoScoreToken, setAutoScoreToken] = useState(0);

  const remaining = useMemo(
    () => Math.max(0, (limitToday || 0) - (usedToday || 0)),
    [limitToday, usedToday]
  );

  // Word counts
  const wordCount = useMemo(
    () => (aiText.trim() ? aiText.trim().split(/\s+/).length : 0),
    [aiText]
  );
  const outputWordCount = useMemo(
    () => (humanText.trim() ? humanText.trim().split(/\s+/).length : 0),
    [humanText]
  );

  // Word limit per plan — unlimited plan has no cap (use 999999 as sentinel)
  // wordLimit is for UI display/enforcement only
  // unlimited plan has no frontend cap (server handles per-request limit)
  const wordLimit = useMemo(() => {
    const p = plan.toUpperCase();
    if (p === "UNLIMITED") return 1500;
    if (p === "PRO") return 1200;
    if (p === "BASIC") return 800;
    return 300;
  }, [plan]);

  const wordLimitDisplay = wordLimit.toLocaleString();

  // File upload allowed for pro/unlimited only
  const canUploadFile = useMemo(() => {
    const p = plan.toUpperCase();
    return p === "PRO" || p === "UNLIMITED";
  }, [plan]);

  // FEATURE 5: AI detection score + highlighting — available from Basic plan up
  const canUseDetection = useMemo(() => {
    const p = plan.toUpperCase();
    return p === "BASIC" || p === "PRO" || p === "UNLIMITED";
  }, [plan]);

  // FEATURE 6: click-to-rewrite — stays Pro/Unlimited only (heavier Gemini cost per click)
  const canUseRewrite = useMemo(() => {
    const p = plan.toUpperCase();
    return p === "PRO" || p === "UNLIMITED";
  }, [plan]);

  const editorRef = useRef(null);

  // Auto-grow both textareas to fit their content instead of sitting at a
  // fixed height with empty space below short text. Capped so a huge paste
  // still scrolls rather than blowing up the page.
  function autoGrow(ref) {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 460; // px
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }

  useEffect(() => { autoGrow(aiTextareaRef); }, [aiText]);
  useEffect(() => { autoGrow(humanTextareaRef); }, [humanText]);

  function showToast(msg) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }

  useEffect(() => {
    setMounted(true);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Load user + history
  useEffect(() => {
    if (!mounted) return;

    const token = localStorage.getItem("token");
    if (!token) {
      // No forced redirect — let people try the tool first. Generate (or
      // reuse) a guestId so the backend can track the 5-try trial.
      let gid = localStorage.getItem("guestId");
      if (!gid) {
        gid = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("guestId", gid);
      }
      setGuestId(gid);
      setIsGuest(true);
      setGuestUsed(Number(localStorage.getItem("guestUsed") || 0));
      return;
    }
    setIsGuest(false);

    // ✅ Handle Stripe payment success redirect
    const payment = searchParams?.get("payment");
    const sessionId = searchParams?.get("session_id");

    if (payment === "success" && sessionId) {
      // Call backend to confirm and upgrade plan from Stripe session
      api.post("/confirm-payment", { sessionId })
        .then((res) => {
          const upgradedPlan = res.data?.plan?.toUpperCase() || "PRO";
          setPlan(upgradedPlan);
          setLimitToday(planLimitFallback(upgradedPlan));
          showToast(`🎉 Upgraded to ${upgradedPlan} plan!`);
          loadMe();
        })
        .catch(() => {
          // webhook may have already handled it, just reload user
          showToast("🎉 Payment successful!");
          loadMe();
        })
        .finally(() => {
          // Clean up URL so refresh doesn't re-trigger
          window.history.replaceState({}, "", "/dashboard");
        });
    } else if (payment === "cancel") {
      showToast("Payment cancelled.");
      window.history.replaceState({}, "", "/dashboard");
    }

    loadMe();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // If we came from /texts/[id] with "Load into editor"
  useEffect(() => {
    if (!mounted) return;

    const pendingRaw = sessionStorage.getItem("loadFromHistory");
    if (pendingRaw) {
      try {
        const payload = JSON.parse(pendingRaw);
        if (payload?.input) setAiText(payload.input);
        if (payload?.output) setHumanText(payload.output);
        sessionStorage.removeItem("loadFromHistory");

        setTimeout(() => {
          editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
        showToast("Loaded from history");
      } catch {
        sessionStorage.removeItem("loadFromHistory");
      }
    }
  }, [mounted]);

  async function loadMe() {
    try {
      const res = await api.get("/me");
      const u = res.data?.user;

      if (u?.plan) setPlan(String(u.plan).toUpperCase());
      else setPlan("FREE");

      if (typeof u?.usedToday === "number") setUsedToday(u.usedToday);
      if (typeof u?.limitToday === "number") setLimitToday(u.limitToday);

      if (u) {
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: u.id,
            name: u.name,
            email: u.email,
            plan: u.plan,
          })
        );
      }
    } catch {
      try {
        const storedUser = JSON.parse(localStorage.getItem("user") || "null");
        const p = storedUser?.plan ? String(storedUser.plan).toUpperCase() : "FREE";
        setPlan(p);
        setLimitToday(planLimitFallback(p));
      } catch {
        setPlan("FREE");
        setLimitToday(planLimitFallback("FREE"));
      }
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    setError("");
    try {
      const res = await api.get("/history");
      // your backend returns { items } not array
      const items = Array.isArray(res.data) ? res.data : res.data?.items || [];
      setHistory(items);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  // FEATURE 1 + 3: start/stop the elapsed-time ticker around the humanise call
  function startTimer(wc) {
    const est = estimateDuration(wc);
    setEstimatedTotal(est);
    setElapsed(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }

  function stopTimer() {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setElapsed(0);
  }

  async function handleHumanise() {
    setError("");

    const t = (aiText || "").trim();
    if (t.length < 5) {
      setError("Please enter at least 5 characters.");
      return;
    }

    if (isGuest) {
      if (guestUsed >= GUEST_TRY_LIMIT) {
        setError("You've used all 5 free tries. Create a free account to keep going.");
        return;
      }
    } else if (usedToday >= limitToday) {
      setError(`Daily limit reached (${limitToday}/day). Upgrade to continue.`);
      return;
    }

    setLoadingHumanise(true);
    startTimer(wordCount);
    setFactCheck(null);
    try {
      const res = isGuest
        ? await api.post("/guest/humanise", { text: t, mode }, { headers: { "x-guest-id": guestId } })
        : await api.post("/humanise", { text: t, mode });

      const out =
        res.data?.humanised ||
        res.data?.output ||
        res.data?.text ||
        res.data?.result ||
        "";

      setHumanText(out);
      setFactCheck(res.data?.factCheck || null);
      // FEATURE 5 + 6: trigger the AI-score/highlight panel to auto-run on this fresh result.
      // (No-op in practice for guests — the detector/highlight panel is a Pro/Unlimited feature.)
      setAutoScoreToken((t) => t + 1);

      if (isGuest) {
        const used = res.data?.usage?.used ?? guestUsed + 1;
        setGuestUsed(used);
        localStorage.setItem("guestUsed", String(used));
        const left = Math.max(0, GUEST_TRY_LIMIT - used);
        showToast(left > 0 ? `✓ Humanised! ${left} free ${left === 1 ? "try" : "tries"} left.` : "✓ That was your last free try.");
      } else {
        // ✅ FIX 1: backend sends usage.used / usage.limit (not usedToday/limitToday)
        if (res.data?.usage) {
          const u = res.data.usage;
          if (typeof u.used === "number") setUsedToday(u.used);
          if (typeof u.limit === "number") setLimitToday(u.limit);
          if (u.plan) setPlan(String(u.plan).toUpperCase());
        }
        // Always sync with server to keep nav badge accurate
        await loadMe();
        showToast("✓ Humanised! Output copied ready.");
        await loadHistory();
      }
    } catch (e) {
      const status = e?.response?.status;
      const backendMsg = e?.response?.data?.message;
      if (isGuest && status === 403) {
        // Trial exhausted server-side — sync the local counter so the UI matches.
        setGuestUsed(GUEST_TRY_LIMIT);
        localStorage.setItem("guestUsed", String(GUEST_TRY_LIMIT));
      }
      setError(backendMsg || "Humanise failed.");
      if (!isGuest && status === 429) await loadMe();
    } finally {
      setLoadingHumanise(false);
      stopTimer();
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";

    if (!file) return;

    const allowed = ["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(file.type) && !file.name.match(/\.(txt|pdf|docx)$/i)) {
      setUploadError("Only .txt, .pdf, or .docx files are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File must be under 5MB.");
      return;
    }

    setUploadError("");
    setUploading(true);

    try {
      if (file.type === "text/plain" || file.name.endsWith(".txt")) {
        // Read plain text directly
        const text = await file.text();
        setAiText(text.trim());
        showToast("File loaded!");
      } else {
        // For PDF/DOCX — send to backend
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post("/upload-file", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setAiText(res.data?.text || "");
        showToast("File loaded!");
      }
    } catch (err) {
      setUploadError(err?.response?.data?.message || "Failed to read file.");
    } finally {
      setUploading(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.replace("/login");
  }

  function goPricing() {
    router.push("/pricing");
  }

  function newHumanise() {
    setAiText("");
    setHumanText("");
    setError("");
    setMenuOpenId(null);

    // route back to dashboard (you’re already here, but keeps it consistent)
    router.push("/dashboard");
    setTimeout(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    showToast("New Humanise");
  }

  async function deleteHistoryItem(id) {
    setMenuOpenId(null);
    try {
      // your backend delete route is /texts/:id
      await api.delete(`/texts/${id}`);
      setHistory((prev) => prev.filter((x) => (x._id || x.id) !== id));
      showToast("Deleted");
    } catch {
      setError("Delete failed.");
    }
  }

  function openHistoryItem(id) {
    setMenuOpenId(null);
    router.push(`/texts/${id}`);
  }

  // FEATURE 3: derive the active progress step + percent from elapsed/estimatedTotal
  const progressFraction = Math.min(0.99, elapsed / Math.max(1, estimatedTotal));
  const activeStepIdx = PROGRESS_STEPS.reduce(
    (acc, step, idx) => (progressFraction >= step.at ? idx : acc),
    0
  );
  const remainingSeconds = Math.max(0, estimatedTotal - elapsed);

  return (
    <>
      <style jsx global>{`
        :root {
          --bg0: #070a12;
          --bg1: #0b1022;
          --card: rgba(255, 255, 255, 0.06);
          --card2: rgba(255, 255, 255, 0.08);
          --stroke: rgba(255, 255, 255, 0.1);
          --text: rgba(255, 255, 255, 0.92);
          --muted: rgba(255, 255, 255, 0.62);
          --muted2: rgba(255, 255, 255, 0.48);
          --accent: #8b78ff;
          --accent2: #6d5dff;
        }
        body {
          margin: 0;
          background: radial-gradient(
              1200px 700px at 55% 20%,
              rgba(139, 120, 255, 0.25),
              transparent 60%
            ),
            radial-gradient(
              900px 600px at 25% 60%,
              rgba(109, 93, 255, 0.18),
              transparent 60%
            ),
            linear-gradient(180deg, var(--bg0), var(--bg1));
          color: var(--text);
          min-height: 100vh;
        }
        * {
          box-sizing: border-box;
        }
        a {
          color: inherit;
          text-decoration: none;
        }

        /* FULL WIDTH layout (remove side space) */
        .pageWrap {
          width: 100%;
          padding: 12px 14px 16px;
        }

        /* Shell */
        .dashShell {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          width: 100%;
        }

        /* Sidebar */
        .historySidebar {
          position: sticky;
          top: 74px;
          height: calc(100vh - 92px);
          border-radius: 18px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06),
            rgba(255, 255, 255, 0.04)
          );
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          flex-shrink: 0;
          transition: width 0.25s ease, min-width 0.25s ease, flex 0.25s ease;
          will-change: width;
        }
        .historySidebar.open {
          width: 300px;
          min-width: 300px;
          flex: 0 0 300px;
        }
        .historySidebar.closed {
          width: 44px;
          min-width: 44px;
          flex: 0 0 44px;
        }

        .historyHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          min-height: 48px;
        }
        .historySidebar.closed .historyHeader {
          justify-content: center;
          padding: 12px 4px;
        }
        .historyTitle {
          font-weight: 800;
          letter-spacing: -0.2px;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .historyHeaderRight {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .btnSmall {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.88);
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .btnSmall:hover {
          border-color: rgba(255, 255, 255, 0.18);
          filter: brightness(1.05);
        }

        .historyBody {
          height: calc(100% - 56px);
          overflow-y: auto;
          padding: 10px;
        }

        .newBtn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(139, 120, 255, 0.28);
          background: rgba(139, 120, 255, 0.12);
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          font-weight: 800;
          margin-bottom: 10px;
        }
        .newBtn:hover {
          border-color: rgba(139, 120, 255, 0.45);
          filter: brightness(1.06);
        }

        .histItem {
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.18);
          padding: 10px 10px;
          cursor: pointer;
          position: relative;
          transition: transform 0.12s ease, border-color 0.12s ease;
        }
        .histItem:hover {
          border-color: rgba(255, 255, 255, 0.18);
          transform: translateY(-1px);
        }

        .histItemActive {
          border-color: rgba(139, 120, 255, 0.55);
          box-shadow: 0 0 0 4px rgba(139, 120, 255, 0.14);
        }

        .histTitle {
          font-weight: 800;
          font-size: 13px;
          line-height: 1.25;
          margin-bottom: 6px;
        }
        .histMeta {
          font-size: 12px;
          color: var(--muted);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        /* 3-dot menu */
        .dotsBtn {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
        }
        .dotsBtn:hover {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .menu {
          position: absolute;
          right: 10px;
          top: 44px;
          z-index: 30;
          width: 170px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(10, 12, 24, 0.9);
          backdrop-filter: blur(10px);
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
        }
        .menu button {
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: 0;
          color: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          text-align: left;
          font-size: 13px;
        }
        .menu button:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .menu .danger {
          color: rgba(255, 170, 170, 0.95);
        }

        /* Main */
        .dashMain {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .editorCard {
          border-radius: 18px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06),
            rgba(255, 255, 255, 0.04)
          );
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 16px;
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.35);
          display: flex;
          flex-direction: column;
        }

        .twoCols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: start;
        }

        .label {
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .textarea {
          width: 100%;
          height: 220px;
          min-height: 220px;
          max-height: 460px;
          overflow-y: auto;
          resize: none;
          border-radius: 14px;
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.92);
          outline: none;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.6;
        }
        .textarea:focus {
          border-color: rgba(139, 120, 255, 0.5);
          box-shadow: 0 0 0 3px rgba(139, 120, 255, 0.16);
        }

        .footerRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .actionRow {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
        }

        .btnPrimary {
          padding: 10px 16px;
          border-radius: 14px;
          border: 1px solid rgba(139, 120, 255, 0.25);
          background: linear-gradient(
            135deg,
            rgba(139, 120, 255, 0.9),
            rgba(109, 93, 255, 0.9)
          );
          color: rgba(255, 255, 255, 0.95);
          cursor: pointer;
          min-width: 120px;
          font-weight: 800;
        }
        .btnPrimary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .toast {
          position: fixed;
          left: 16px;
          bottom: 18px;
          z-index: 60;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(10, 12, 24, 0.72);
          backdrop-filter: blur(10px);
          color: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          font-size: 13px;
        }

        /* FEATURE 3: progress steps */
        .progressWrap {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .progressStepRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .progressStepLabel {
          font-size: 12px;
          color: var(--muted);
          min-width: 150px;
        }
        .progressStepLabel.active {
          color: rgba(255, 255, 255, 0.92);
          font-weight: 700;
        }
        .progressBarTrack {
          flex: 1;
          height: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .progressBarFill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(139, 120, 255, 0.9), rgba(109, 93, 255, 0.9));
          transition: width 0.4s ease;
        }
        .progressPercent {
          font-size: 12px;
          color: var(--muted);
          min-width: 34px;
          text-align: right;
        }

        /* FEATURE 5 + 6: AI Detection analysis panel — academic "report" styling */
        .analysisCard {
          margin-top: 14px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .analysisPanel {
          margin-top: 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(255, 255, 255, 0.025);
          padding: 14px;
        }
        .analysisHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .analysisHeaderLeft {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .analysisTitle {
          font-size: 12px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: var(--muted2);
          font-weight: 700;
        }
        .analysisBigScore {
          font-size: 22px;
          font-weight: 900;
          line-height: 1;
        }
        .analysisMuted {
          font-size: 12px;
          color: var(--muted);
        }
        .analysisDisclaimer {
          font-size: 10.5px;
          color: var(--muted2);
          font-style: italic;
        }
        .highlightBox {
          padding: 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.16);
          line-height: 1.85;
          font-size: 14px;
        }
        .legendRow {
          margin-top: 8px;
          display: flex;
          gap: 14px;
          font-size: 11px;
          color: var(--muted);
          flex-wrap: wrap;
        }
        .legendDot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 2px;
          margin-right: 4px;
        }

        /* responsive */
        @media (max-width: 980px) {
          .dashShell {
            flex-direction: column;
          }
          .historySidebar.open,
          .historySidebar.closed {
            width: 100% !important;
            min-width: 100% !important;
            flex: none !important;
            height: auto;
            position: relative;
            top: auto;
          }
          .historyBody {
            height: auto;
            max-height: 360px;
          }
          .twoCols {
            grid-template-columns: 1fr;
          }
          .textarea {
            height: 280px;
            min-height: 200px;
          }
        }
      `}</style>

      {/* Top Nav */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(10px)",
          background: "rgba(5, 8, 16, 0.45)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            width: "100%",
            padding: "14px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between", // left + right as you asked
            gap: 12,
          }}
        >
          {/* LEFT: brand + links */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(139,120,255,0.9), rgba(109,93,255,0.9))",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 10px 30px rgba(139,120,255,0.25)",
                fontWeight: 900,
                flex: "0 0 auto",
              }}
              aria-label="AI Humaniser"
              title="AI Humaniser"
            >
              ✦
            </div>

            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span style={{ fontWeight: 900 }}>AI Humaniser</span>
              <span style={{ fontSize: 12, color: "var(--muted2)" }}>Dashboard</span>
            </div>

            <div style={{ display: "flex", gap: 14, marginLeft: 14, color: "var(--muted)" }}>
              <a href="/dashboard" style={{ opacity: 0.95 }}>
                Dashboard
              </a>
              <a href="/pricing" style={{ opacity: 0.75 }}>
                Pricing
              </a>
            </div>
          </div>

          {/* RIGHT: plan + buttons (guest-aware) */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                background: isGuest ? "rgba(255,209,102,0.12)" : "rgba(139,120,255,0.12)",
                border: `1px solid ${isGuest ? "rgba(255,209,102,0.28)" : "rgba(139,120,255,0.25)"}`,
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              {isGuest
                ? <>Free trial: <b>{guestUsed}</b> / {GUEST_TRY_LIMIT} tries used</>
                : <>Plan: <b>{plan}</b> • Used today: <b>{usedToday}</b> / {limitToday}</>}
            </div>

            {isGuest ? (
              <>
                <button
                  onClick={() => router.push("/login")}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  Log in
                </button>
                <button
                  onClick={() => router.push("/register")}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(139,120,255,0.25)",
                    background: "linear-gradient(135deg, rgba(139,120,255,0.9), rgba(109,93,255,0.9))",
                    color: "rgba(255,255,255,0.95)",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Sign up free
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={goPricing}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  Upgrade
                </button>

                <button
                  onClick={logout}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Page */}
      <div className="pageWrap">
        <div className="dashShell">
          {/* Sidebar */}
          <aside className={`historySidebar ${historyOpen ? "open" : "closed"}`}>
            <div className="historyHeader">
              {historyOpen && <div className="historyTitle">History</div>}

              <div className="historyHeaderRight">

                <button
                  className="btnSmall"
                  onClick={() => setHistoryOpen((v) => !v)}
                  title={historyOpen ? "Collapse sidebar" : "Open sidebar"}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                >
                  {historyOpen ? "←" : "→"}
                </button>
              </div>
            </div>

            <div className="historyBody" onClick={() => setMenuOpenId(null)}>
              {historyOpen ? (
                <button className="newBtn" onClick={newHumanise}>
                  + New Humanise
                </button>
              ) : null}

              {isGuest ? (
                historyOpen && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: "1px dashed rgba(255,209,102,0.25)",
                      color: "var(--muted)",
                      background: "rgba(255,209,102,0.05)",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    Your history isn't saved as a guest.{" "}
                    <a href="/register" style={{ color: "#ffd166", fontWeight: 700 }}>Create a free account</a> to keep every humanised result.
                  </div>
                )
              ) : (
                <>
                  {historyOpen ? (
                    <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
                      {loadingHistory ? "Loading..." : `${history.length} item${history.length === 1 ? "" : "s"}`}
                    </div>
                  ) : null}

                  {!loadingHistory && history.length === 0 && historyOpen && (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px dashed rgba(255,255,255,0.14)",
                        color: "var(--muted)",
                        background: "rgba(0,0,0,0.18)",
                        fontSize: 13,
                      }}
                    >
                      No history yet.
                    </div>
                  )}

                  <div style={{ display: "grid", gap: 10 }}>
                    {history.map((item) => {
                      const id = item._id || item.id;
                      const createdAt = item.createdAt || item.timestamp || item.date;
                      const input = item.input || item.aiText || item.text || "";
                      const title = makeTitle(input);

                      return (
                        <div

                      key={id}
                      className={`histItem ${"" /* dashboard has no "active" */}`}
                      onClick={() => openHistoryItem(id)}
                    >
                      {historyOpen ? (
                        <>
                          <div className="histTitle">{title}</div>
                          <div className="histMeta">
                            <span>{createdAt ? new Date(createdAt).toLocaleString() : ""}</span>

                            <button
                              className="dotsBtn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId((prev) => (prev === id ? null : id));
                              }}
                              aria-label="More"
                              title="More"
                            >
                              ⋯
                            </button>
                          </div>

                          {menuOpenId === id && (
                            <div
                              className="menu"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                            >
                              <button onClick={() => openHistoryItem(id)}>Open</button>
                              <button className="danger" onClick={() => deleteHistoryItem(id)}>
                                Delete
                              </button>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
                </>
              )}
            </div>
          </aside>

          {/* Main */}
          <main className="dashMain">

            

            <div className="editorCard" ref={editorRef} style={{ flex: 1 }}>
              <div className="twoCols">
                {/* ── Input pane ── */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="label" style={{ marginBottom: 0 }}>AI Content</div>
                      {/* Mode selector */}
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                        style={{
                          padding: "4px 10px", borderRadius: 8,
                          border: "1px solid rgba(139,120,255,0.3)",
                          background: "#0f1224",
                          color: "rgba(255,255,255,0.9)",
                          fontSize: 12, cursor: "pointer",
                          outline: "none",
                          appearance: "auto",
                          WebkitAppearance: "auto",
                        }}
                      >
                        <option value="standard"  style={{ background: "#0f1224", color: "#fff" }}>Standard</option>
                        <option value="professional" style={{ background: "#0f1224", color: "#fff" }}>Professional ✦</option>
                        <option value="academic"  style={{ background: "#0f1224", color: "#fff" }}>Academic</option>
                        <option value="creative"  style={{ background: "#0f1224", color: "#fff" }}>Creative</option>
                        <option value="casual"    style={{ background: "#0f1224", color: "#fff" }}>Casual</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* Clear input button — only shows once there's something to clear */}
                      {aiText && (
                        <button
                          onClick={() => {
                            setAiText("");
                            setUploadError("");
                          }}
                          title="Clear input"
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            border: "1px solid rgba(255,120,120,0.22)",
                            background: "rgba(255,120,120,0.08)",
                            color: "rgba(255,180,180,0.9)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 14,
                            flex: "0 0 auto",
                          }}
                        >
                          🗑
                        </button>
                      )}

                      {/* Word count badge */}
                      <span style={{
                        fontSize: 12,
                        color: wordCount > wordLimit ? "rgba(255,120,80,0.95)" : "var(--muted)",
                        background: wordCount > wordLimit ? "rgba(255,120,80,0.1)" : "rgba(255,255,255,0.06)",
                        border: `1px solid ${wordCount > wordLimit ? "rgba(255,120,80,0.28)" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: 8,
                        padding: "3px 9px",
                        fontWeight: 600,
                        transition: "all 0.2s",
                      }}>
                        {wordCount.toLocaleString()} / {wordLimitDisplay} words
                      </span>

                      {/* Upload button — Pro & Unlimited only */}
                      {canUploadFile ? (
                        <>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".txt,.pdf,.docx"
                            style={{ display: "none" }}
                            onChange={handleFileUpload}
                          />
                          <button
                            style={{
                              padding: "4px 12px",
                              borderRadius: 8,
                              border: "1px solid rgba(139,120,255,0.3)",
                              background: "rgba(139,120,255,0.1)",
                              color: "rgba(255,255,255,0.85)",
                              fontSize: 12,
                              cursor: uploading ? "not-allowed" : "pointer",
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              opacity: uploading ? 0.6 : 1,
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            title="Upload .txt, .pdf, or .docx"
                          >
                            {uploading ? "⏳ Loading..." : "📄 Upload file"}
                          </button>
                        </>
                      ) : (
                        <button
                          style={{
                            padding: "3px 10px",
                            borderRadius: 8,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "transparent",
                            color: "rgba(255,255,255,0.22)",
                            fontSize: 11,
                            cursor: "pointer",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            letterSpacing: 0.2,
                          }}
                          onClick={() => router.push("/pricing")}
                          title="Upgrade to Pro or Unlimited to upload files"
                        >
                          🔒 Pro only
                        </button>
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={aiTextareaRef}
                    className="textarea"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    placeholder="Paste AI-generated text here..."
                  />

                  {/* Upload error */}
                  {uploadError && (
                    <div style={{
                      marginTop: 6, padding: "7px 10px", borderRadius: 8,
                      background: "rgba(255,120,80,0.1)", border: "1px solid rgba(255,120,80,0.22)",
                      color: "rgba(255,200,180,0.95)", fontSize: 12,
                    }}>
                      {uploadError}
                    </div>
                  )}

                  {/* Word limit warning */}
                  {wordCount > wordLimit && (
                    <div style={{
                      marginTop: 6, padding: "7px 10px", borderRadius: 8,
                      background: "rgba(255,120,80,0.1)", border: "1px solid rgba(255,120,80,0.22)",
                      color: "rgba(255,200,180,0.95)", fontSize: 12,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span>⚠ Over word limit by {wordCount - wordLimit} words</span>
                      {plan.toUpperCase() !== "UNLIMITED" && (
                        <button
                          style={{ background: "none", border: "none", color: "#a78bfa", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                          onClick={() => router.push("/pricing")}
                        >Upgrade plan →</button>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Output pane ── */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div className="label" style={{ marginBottom: 0 }}>Humanised Output</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* Output word count */}
                      {outputWordCount > 0 && (
                        <span style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          background: "rgba(125,239,160,0.08)",
                          border: "1px solid rgba(125,239,160,0.18)",
                          borderRadius: 8,
                          padding: "3px 9px",
                          fontWeight: 600,
                        }}>
                          {outputWordCount} words
                        </span>
                      )}
                      {/* Copy button - shows "Copied!" inline */}
                      {humanText && (
                        <CopyButton text={humanText} />
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={humanTextareaRef}
                    className="textarea"
                    value={humanText}
                    onChange={(e) => setHumanText(e.target.value)}
                    placeholder="Your humanised result will appear here..."
                  />

                  {factCheck && factCheck.numbersPreserved === false && (
                    <div style={{
                      marginTop: 6, padding: "7px 10px", borderRadius: 8,
                      background: "rgba(255,209,102,0.08)", border: "1px solid rgba(255,209,102,0.22)",
                      color: "rgba(255,224,160,0.95)", fontSize: 12,
                    }}>
                      ⚠ Some numbers/dates from your original text may have changed during rewriting
                      {factCheck.missingNumbers?.length ? ` (check: ${factCheck.missingNumbers.slice(0, 5).join(", ")})` : ""}.
                      Please verify important figures and citations before using this output.
                    </div>
                  )}
                </div>
              </div>

              {/* FEATURE 3: progress steps — shown only while humanising */}
              {loadingHumanise && (
                <div className="progressWrap">
                  {PROGRESS_STEPS.map((step, idx) => {
                    const isActive = idx === activeStepIdx;
                    const isDone = idx < activeStepIdx;
                    const stepStart = step.at;
                    const stepEnd = PROGRESS_STEPS[idx + 1]?.at ?? 1;
                    const stepFraction = isDone
                      ? 1
                      : isActive
                        ? Math.min(1, (progressFraction - stepStart) / Math.max(0.0001, stepEnd - stepStart))
                        : 0;
                    return (
                      <div className="progressStepRow" key={step.label}>
                        <span className={`progressStepLabel ${isActive ? "active" : ""}`}>
                          {isDone ? "✓ " : ""}{step.label}
                        </span>
                        <div className="progressBarTrack">
                          <div className="progressBarFill" style={{ width: `${Math.round(stepFraction * 100)}%` }} />
                        </div>
                        <span className="progressPercent">{Math.round(stepFraction * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Humanise button + limit info — sits right under the editor, not below the analysis panel */}
              <div className="footerRow">
                <div style={{ fontSize: 12, color: "var(--muted2)" }}>
                  {isGuest ? (
                    guestUsed >= GUEST_TRY_LIMIT ? (
                      <span style={{ color: "rgba(255,209,102,0.95)" }}>
                        Free trial complete.{" "}
                        <a href="/register" style={{ color: "#ffd166", fontWeight: 700 }}>Create a free account</a> to keep humanising.
                      </span>
                    ) : (
                      <span>{GUEST_TRY_LIMIT - guestUsed} free {GUEST_TRY_LIMIT - guestUsed === 1 ? "try" : "tries"} left — sign up anytime to save your history.</span>
                    )
                  ) : remaining === 0 ? (
                    <span style={{ color: "rgba(255,120,120,0.95)" }}>
                      Daily limit reached.{" "}
                      <a href="/pricing" style={{ color: "#a78bfa", fontWeight: 700 }}>Upgrade →</a>
                    </span>
                  ) : (
                    <span>Output is saved to history.</span>
                  )}
                </div>

                <div className="actionRow">
                  {isGuest && guestUsed >= GUEST_TRY_LIMIT ? (
                    <button className="btnPrimary" onClick={() => router.push("/register")}>
                      Sign up to continue
                    </button>
                  ) : (
                    <button
                      className="btnPrimary"
                      onClick={handleHumanise}
                      disabled={loadingHumanise || (wordCount > wordLimit && plan.toUpperCase() !== "UNLIMITED")}
                      title={wordCount > wordLimit ? `Reduce text to under ${wordLimit} words` : ""}
                    >
                      {/* FEATURE 1: countdown timer in the button label */}
                      {loadingHumanise ? `Working… (~${remainingSeconds}s)` : "Humanise"}
                    </button>
                  )}
                </div>
              </div>

              {error ? (
                <div
                  style={{
                    marginTop: 12, padding: "10px 12px", borderRadius: 12,
                    background: "rgba(255,120,120,0.08)", border: "1px solid rgba(255,120,120,0.18)",
                    color: "rgba(255,210,210,0.95)", fontSize: 13,
                  }}
                >
                  {error}
                </div>
              ) : null}

              {/* FEATURE 5 + 6: auto AI score + highlighted click-to-rewrite — full width, below the button */}
              <AiHighlightPanel
                humanText={humanText}
                setHumanText={setHumanText}
                canUse={canUseDetection}
                canRewrite={canUseRewrite}
                mode={mode}
                router={router}
                autoToken={autoScoreToken}
              />
            </div>
          </main>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: "rgba(255,255,255,0.7)", background: "#0b1022", minHeight: "100vh" }}>Loading…</div>}>
      <DashboardContent />
    </Suspense>
  );
}