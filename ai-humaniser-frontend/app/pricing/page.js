"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "../../lib/api";

export default function PricingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userPlan, setUserPlan] = useState("FREE");
  const [usedToday, setUsedToday] = useState(0);
  const [limitToday, setLimitToday] = useState(5);
  const [billing, setBilling] = useState("monthly");
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    setIsLoggedIn(!!token);
    if (token) {
      api.get("/me").then((res) => {
        const u = res.data?.user;
        if (u) {
          setUserPlan(String(u.plan || "free").toUpperCase());
          setUsedToday(u.usedToday || 0);
          setLimitToday(u.limitToday || 5);
        }
      }).catch(() => {});
    }
  }, []);

  // MYR pricing from your table
  // Monthly: RM9 / RM19 / RM39
  // Yearly: ~20% discount → RM86/yr (RM7.2/mo), RM182/yr (RM15/mo), RM374/yr (RM31/mo)
  const plans = useMemo(() => [
    {
      id: "free",
      name: "Free",
      dailyLimit: "5/day",
      monthlyRequests: "~150/month",
      monthlyPrice: 0,
      yearlyTotal: 0,
      yearlyMonthly: 0,
      save: null,
      isFree: true,
      features: [
        "300 words per request",
        "5 humanises/day",
        "View history",
        "Standard mode",
      ],
      notIncluded: ["File upload", "Academic & creative modes", "AI detector credits"],
    },
    {
      id: "basic",
      name: "Basic",
      dailyLimit: "15/day",
      monthlyRequests: "~750/month",
      monthlyPrice: 9,
      yearlyTotal: 86,
      yearlyMonthly: 7,
      save: "Save 20%",
      features: [
        "800 words per request",
        "15 humanises/day",
        "~450 requests/month",
        "View history",
        "Standard & casual modes",
        "Private rewriting model",
      ],
      notIncluded: ["Academic & creative modes", "AI detector credits"],
    },
    {
      id: "pro",
      name: "Pro",
      dailyLimit: "50/day",
      monthlyRequests: "~3,000/month",
      monthlyPrice: 19,
      yearlyTotal: 182,
      yearlyMonthly: 15,
      save: "Save 20%",
      highlight: true,
      features: [
        "1,200 words per request",
        "50 humanises/day",
        "~1,500 requests/month",
        "View history",
        "All 4 rewrite modes",
        "Private rewriting model",
        "100 AI detector credits/month",
        "Docs upload + humanise (text PDFs)",
      ],
    },
    {
      id: "unlimited",
      name: "Unlimited",
      dailyLimit: "300/day (fair use)",
      monthlyRequests: "~9,000/month",
      monthlyPrice: 49,
      yearlyTotal: 470,
      yearlyMonthly: 39,
      save: "Save 20%",
      features: [
        "1,500 words per request",
        "150 humanises/day (fair use)",
        "~4,500 requests/month",
        "View history",
        "All 4 rewrite modes",
        "Private rewriting model",
        "200 AI detector credits/month",
        "Docs upload + humanise",
        "OCR for scanned PDFs",
        "Priority support",
      ],
    },
  ], []);

  const handleStartFree = (e) => {
    e.preventDefault();
    router.push(isLoggedIn ? "/dashboard" : "/register");
  };

  async function downgradeToFree() {
    if (!isLoggedIn) { router.push("/register"); return; }
    const confirmed = window.confirm("Downgrade to Free plan? You will lose your current plan features.");
    if (!confirmed) return;
    try {
      await api.post("/downgrade-to-free");
      setUserPlan("FREE");
      router.push("/dashboard");
    } catch {
      router.push("/dashboard");
    }
  }

  async function buyPlan(planId) {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { router.push("/register"); return; }

    setError("");
    setLoadingPlan(planId);
    try {
      const res = await api.post("/create-checkout-session", { plan: planId });
      window.location.href = res.data.url;
    } catch (err) {
      setError(err?.response?.data?.message || "Payment failed. Please try again.");
      setLoadingPlan(null);
    }
  }

  return (
    <div style={s.page}>
      {/* Topbar */}
      <header style={s.topbar}>
        <div style={s.brand}>
          <div style={s.logo}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 15 }}>AI Humaniser</span>
        </div>
        <nav style={s.nav}>
          <Link href="/dashboard" style={s.navLink}>Dashboard</Link>
          <Link href="/pricing" style={{ ...s.navLink, color: "#fff" }}>Pricing</Link>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {mounted && isLoggedIn && (
            <div style={{
              padding: "6px 12px", borderRadius: 999,
              background: "rgba(139,120,255,0.12)",
              border: "1px solid rgba(139,120,255,0.25)",
              color: "rgba(255,255,255,0.9)", fontSize: 13, whiteSpace: "nowrap",
            }}>
              Plan: <strong>{userPlan}</strong> · {usedToday} / {limitToday} today
            </div>
          )}
          <button style={s.ctaBtn} onClick={handleStartFree}>
            {mounted ? (isLoggedIn ? "Dashboard" : "Start Free") : "Start Free"}
          </button>
        </div>
      </header>

      <main style={s.container}>
        <h1 style={s.title}>Purchase a subscription</h1>
        <p style={s.subtitle}>
          Choose the appropriate plan based on the number of words you need to humanise.
        </p>

        {/* Billing toggle */}
        <div style={s.toggleWrap}>
          <div style={s.toggle}>
            <button
              style={{ ...s.toggleBtn, ...(billing === "monthly" ? s.toggleActive : {}) }}
              onClick={() => setBilling("monthly")}
            >Monthly</button>
            <button
              style={{ ...s.toggleBtn, ...(billing === "yearly" ? s.toggleActive : {}) }}
              onClick={() => setBilling("yearly")}
            >
              Yearly
              <span style={s.savePill}>Save up to 20%</span>
            </button>
          </div>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {/* Plan cards */}
        <div style={s.grid}>
          {plans.map((p) => {
            const price = billing === "monthly" ? p.monthlyPrice : p.yearlyMonthly;
            const billedNote = p.isFree ? "Free forever" : (
              billing === "monthly"
                ? `RM${p.monthlyPrice}/month`
                : `RM${p.yearlyTotal}/year`
            );

            return (
              <div key={p.id} style={{
                ...s.card,
                ...(p.highlight ? s.cardHot : {}),
                ...(p.isFree ? s.cardFree : {}),
              }}>
                {p.highlight && <div style={s.hotBadge}>Most Popular</div>}
                {p.isFree && <div style={s.freeBadge}>✦ Free forever</div>}

                <div style={s.cardTop}>
                  <div>
                    <div style={s.planName}>{p.name}</div>
                  </div>
                  {p.save && <div style={s.saveBadge}>{p.save}</div>}
                </div>

                <div style={s.priceRow}>
                  {p.isFree ? (
                    <>
                      <span style={{ ...s.price, fontSize: 44, letterSpacing: -2 }}>RM 0</span>
                      <div style={{ ...s.priceMeta, marginLeft: 10 }}>
                        <div>forever</div>
                        <div style={{ opacity: 0.55, fontSize: 12 }}>No credit card</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={s.currency}>RM</span>
                      <span style={s.price}>{price}</span>
                      <div style={s.priceMeta}>
                        <div>per month</div>
                        <div style={{ opacity: 0.65, fontSize: 12 }}>Billed {billedNote}</div>
                      </div>
                    </>
                  )}
                </div>

                {p.isFree ? (
                  !mounted || !isLoggedIn ? (
                    <button style={s.freeBtn} onClick={handleStartFree}>
                      Start for free
                    </button>
                  ) : userPlan === "FREE" ? (
                    <button style={{ ...s.freeBtn, opacity: 0.5, cursor: "default", borderColor: "rgba(125,239,160,0.4)", color: "#7defa0" }} disabled>
                      ✓ Current plan
                    </button>
                  ) : (
                    <button style={{ ...s.freeBtn, borderColor: "rgba(255,120,80,0.3)", color: "rgba(255,180,150,0.8)" }} onClick={downgradeToFree}>
                      Downgrade to free
                    </button>
                  )
                ) : (
                  <button
                    style={{
                      ...s.buyBtn,
                      ...(p.highlight ? s.buyBtnHot : {}),
                      ...(mounted && isLoggedIn && userPlan === p.id.toUpperCase() ? {
                        background: "rgba(125,239,160,0.15)",
                        border: "1px solid rgba(125,239,160,0.4)",
                        color: "#7defa0",
                        cursor: "default",
                      } : {}),
                    }}
                    disabled={loadingPlan === p.id || (mounted && isLoggedIn && userPlan === p.id.toUpperCase())}
                    onClick={() => {
                      if (mounted && isLoggedIn && userPlan === p.id.toUpperCase()) return;
                      buyPlan(p.id);
                    }}
                  >
                    {loadingPlan === p.id
                      ? "Redirecting…"
                      : (mounted && isLoggedIn && userPlan === p.id.toUpperCase())
                        ? "✓ Current plan"
                        : "Buy Now"}
                  </button>
                )}

                <ul style={s.list}>
                  {p.features.map((f) => (
                    <li key={f} style={s.li}>
                      <span style={{ color: "#7defa0", marginRight: 8, flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                  {p.notIncluded?.map((n) => (
                    <li key={n} style={{ ...s.li, opacity: 0.38 }}>
                      <span style={{ marginRight: 8, flexShrink: 0 }}>✕</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>



        {/* Comparison table */}
        <div style={s.tableWrap}>
          <h2 style={s.tableTitle}>Plan comparison</h2>
          <div style={s.tableScroll}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Plan</th>
                  <th style={s.th}>Price (MYR/mo)</th>
                  <th style={s.th}>Daily Limit</th>
                  <th style={s.th}>Est. Requests/Month</th>
                  <th style={s.th}>Approx Tokens/Month</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Free",      "RM0",  "5/day",               "~150",   "~375K"],
                  ["Basic",     "RM9",  "15/day",              "~450",   "~1.1M"],
                  ["Pro",       "RM19", "50/day",              "~1,500", "~3.8M"],
                  ["Unlimited*","RM49", "150/day (fair use)",  "~4,500", "~11.3M"],
                ].map(([plan, price, daily, monthly, tokens]) => (
                  <tr key={plan} style={s.tr}>
                    <td style={{ ...s.td, fontWeight: 700 }}>{plan}</td>
                    <td style={s.td}>{price}</td>
                    <td style={s.td}>{daily}</td>
                    <td style={s.td}>{monthly}</td>
                    <td style={s.td}>{tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={s.tableNote}>* Unlimited plan uses fair-use policy — max 150 humanises/day.</p>
        </div>
      </main>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1000px 600px at 50% 10%, rgba(139,120,255,0.18), transparent 60%), linear-gradient(180deg,#070a12,#0b1022)",
    color: "rgba(255,255,255,0.92)",
    fontFamily: "system-ui,-apple-system,sans-serif",
  },
  topbar: {
    position: "sticky", top: 0, zIndex: 10,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 24px", height: 54,
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(5,8,16,0.55)", backdropFilter: "blur(12px)",
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  logo: {
    width: 32, height: 32, borderRadius: 10,
    background: "linear-gradient(135deg,#8b78ff,#6d5dff)",
    display: "grid", placeItems: "center", fontSize: 14, fontWeight: 900,
  },
  nav: { display: "flex", gap: 8 },
  navLink: { color: "rgba(255,255,255,0.6)", textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "6px 12px", borderRadius: 10 },
  ctaBtn: {
    padding: "8px 16px", borderRadius: 10,
    background: "linear-gradient(135deg,#8b78ff,#6d5dff)",
    border: "none", color: "#fff", fontWeight: 900, cursor: "pointer", fontSize: 13,
  },
  container: { maxWidth: 1100, margin: "0 auto", padding: "52px 20px 80px" },
  title: { textAlign: "center", fontSize: 46, fontWeight: 900, margin: 0, letterSpacing: -1 },
  subtitle: { textAlign: "center", marginTop: 12, opacity: 0.7, lineHeight: 1.6 },
  toggleWrap: { display: "flex", justifyContent: "center", margin: "28px 0 0" },
  toggle: {
    display: "flex", gap: 6, padding: 6, borderRadius: 999,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  },
  toggleBtn: {
    border: "none", background: "transparent", color: "rgba(255,255,255,0.65)",
    padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontWeight: 700, fontSize: 13,
    display: "flex", alignItems: "center", gap: 8,
  },
  toggleActive: { background: "rgba(139,120,255,0.2)", color: "#fff", boxShadow: "0 8px 20px rgba(139,120,255,0.15)" },
  savePill: {
    fontSize: 11, padding: "2px 8px", borderRadius: 999,
    background: "rgba(125,239,160,0.15)", border: "1px solid rgba(125,239,160,0.25)", color: "#7defa0",
  },
  errorBox: {
    maxWidth: 600, margin: "16px auto 0", padding: "10px 16px", borderRadius: 12,
    background: "rgba(255,80,80,.1)", border: "1px solid rgba(255,80,80,.22)",
    color: "rgba(255,180,180,.95)", fontSize: 13, textAlign: "center",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
    gap: 16, marginTop: 32,
  },
  card: {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 22, padding: 24, position: "relative", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  cardHot: {
    background: "linear-gradient(180deg,rgba(139,120,255,0.18),rgba(255,255,255,0.03))",
    border: "1px solid rgba(139,120,255,0.35)", boxShadow: "0 24px 70px rgba(139,120,255,0.2)",
  },
  hotBadge: {
    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
    padding: "4px 14px", borderRadius: 999,
    background: "linear-gradient(135deg,#8b78ff,#6d5dff)",
    color: "#fff", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap",
    boxShadow: "0 6px 20px rgba(139,120,255,0.4)",
  },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  planName: { fontSize: 26, fontWeight: 900 },
  planWords: { fontSize: 13, opacity: 0.75, marginTop: 4 },
  saveBadge: {
    fontSize: 11, padding: "4px 10px", borderRadius: 999,
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
  },
  priceRow: { display: "flex", alignItems: "baseline", gap: 4, marginBottom: 16 },
  currency: { fontSize: 22, fontWeight: 900, opacity: 0.8, marginRight: 2 },
  price: { fontSize: 54, fontWeight: 900, letterSpacing: -2, lineHeight: 1 },
  priceMeta: { fontSize: 13, opacity: 0.8, lineHeight: 1.4, marginLeft: 8 },
  buyBtn: {
    width: "100%", padding: "13px 0", borderRadius: 14,
    background: "linear-gradient(135deg,rgba(139,120,255,0.7),rgba(109,93,255,0.7))",
    border: "1px solid rgba(139,120,255,0.35)",
    color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", marginBottom: 20,
  },
  buyBtnHot: {
    background: "linear-gradient(135deg,#ff3d5a,#ff7a18)", border: "none",
    boxShadow: "0 8px 28px rgba(255,61,90,0.35)",
  },
  list: { listStyle: "none", padding: 0, margin: 0, lineHeight: 2.1 },
  li: { fontSize: 13, display: "flex", alignItems: "flex-start" },
  freeLine: { marginTop: 40, textAlign: "center", fontSize: 14, opacity: 0.75 },
  cardFree: {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.07)",
    opacity: 0.9,
  },
  freeBadge: {
    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
    padding: "4px 14px", borderRadius: 999,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: 700,
    whiteSpace: "nowrap",
  },
  freeBtn: {
    width: "100%", padding: "12px 0", borderRadius: 14,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 14,
    cursor: "pointer", marginBottom: 20,
    transition: "border-color 0.15s, color 0.15s",
  },
  freeLink: {
    background: "none", border: "none", color: "#a78bfa",
    cursor: "pointer", fontWeight: 700, fontSize: 14, textDecoration: "underline",
  },
  tableWrap: { marginTop: 64 },
  tableTitle: { textAlign: "center", fontSize: 28, fontWeight: 900, marginBottom: 20 },
  tableScroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left", padding: "12px 16px", fontWeight: 700,
    borderBottom: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.65)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5,
  },
  tr: { borderBottom: "1px solid rgba(255,255,255,0.06)" },
  td: { padding: "14px 16px", color: "rgba(255,255,255,0.85)" },
  tableNote: { marginTop: 12, fontSize: 12, opacity: 0.5, textAlign: "center" },
};