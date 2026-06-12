"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// ✅ FIX 2: Inline copy button that shows "Copied!" in place
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
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "✓ Copied!" : "Copy"}
    </button>
  );
}

export default function DashboardPage() {
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

  const [historyOpen, setHistoryOpen] = useState(true);

  // 3-dot menu state
  const [menuOpenId, setMenuOpenId] = useState(null);

  // File upload
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState("standard");

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

  const editorRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }

  useEffect(() => {
    setMounted(true);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Load user + history
  useEffect(() => {
    if (!mounted) return;

    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

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

  async function handleHumanise() {
    setError("");

    const t = (aiText || "").trim();
    if (t.length < 5) {
      setError("Please enter at least 5 characters.");
      return;
    }

    if (usedToday >= limitToday) {
      setError(`Daily limit reached (${limitToday}/day). Upgrade to continue.`);
      return;
    }

    setLoadingHumanise(true);
    try {
      const res = await api.post("/humanise", { text: t, mode });

      const out =
        res.data?.humanised ||
        res.data?.output ||
        res.data?.text ||
        res.data?.result ||
        "";

      setHumanText(out);

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
    } catch (e) {
      const status = e?.response?.status;
      const backendMsg = e?.response?.data?.message;
      setError(backendMsg || "Humanise failed.");
      if (status === 429) await loadMe();
    } finally {
      setLoadingHumanise(false);
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
          flex: 1;
        }

        .label {
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .textarea {
          width: 100%;
          height: calc(100vh - 280px);
          min-height: 320px;
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

          {/* RIGHT: plan + buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(139,120,255,0.12)",
                border: "1px solid rgba(139,120,255,0.25)",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              Plan: <b>{plan}</b> • Used today: <b>{usedToday}</b> / {limitToday}
            </div>

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
                    className="textarea"
                    value={humanText}
                    onChange={(e) => setHumanText(e.target.value)}
                    placeholder="Your humanised result will appear here..."
                  />
                </div>
              </div>

              <div className="footerRow">
                <div style={{ fontSize: 12, color: "var(--muted2)" }}>
                  {remaining === 0 ? (
                    <span style={{ color: "rgba(255,120,120,0.95)" }}>
                      Daily limit reached.{" "}
                      <a href="/pricing" style={{ color: "#a78bfa", fontWeight: 700 }}>Upgrade →</a>
                    </span>
                  ) : (
                    <span>Output is saved to history.</span>
                  )}
                </div>

                <div className="actionRow">
                  <button
                    className="btnPrimary"
                    onClick={handleHumanise}
                    disabled={loadingHumanise || (wordCount > wordLimit && plan.toUpperCase() !== "UNLIMITED")}
                    title={wordCount > wordLimit ? `Reduce text to under ${wordLimit} words` : ""}
                  >
                    {loadingHumanise ? "Working..." : "Humanise"}
                  </button>
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
            </div>
          </main>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}