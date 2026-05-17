"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function PricingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState("yearly"); // "monthly" | "yearly"

  const plans = useMemo(() => {
    return [
      {
        name: "Basic",
        words: "15,000 words/month",
        monthly: 6,
        yearly: 72,
        save: "Save 60%",
        button: "Buy Now",
        features: ["500 words per request", "View history", "Support all rewrite styles", "Private rewriting model"],
        notIncluded: ["Support all AI detectors"],
      },
      {
        name: "Pro",
        words: "50,000 words/month",
        monthly: 10,
        yearly: 120,
        save: "Save 60%",
        highlight: true,
        button: "Buy Now",
        features: [
          "1500 words per request",
          "Autopilot Pro mode",
          "View history",
          "Support all rewrite styles",
          "Private rewriting model",
          "Support 100 credits/month AI detector",
          "Docs upload + humanise (text PDFs)",
        ],
      },
      {
        name: "Unlimited",
        words: "Unlimited words/month",
        monthly: 20,
        yearly: 240,
        save: "Save 50%",
        button: "Buy Now",
        features: [
          "3000 words per request",
          "Autopilot Pro mode",
          "View history",
          "Support all rewrite styles",
          "Private rewriting model",
          "Support 200 credits/month AI detector",
          "Docs upload + humanise",
          "OCR for scanned PDFs (Plus/Unlimited)",
        ],
      },
    ];
  }, []);

  const handleStartFree = (e) => {
    e.preventDefault();
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    router.push(token ? "/dashboard" : "/register");
  };

  async function buyPlan() {
    const res = await api.post("/create-checkout-session");
    window.location.href = res.data.url;
  }

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.logo} />
          <div style={{ fontWeight: 700 }}>AI Humaniser</div>
        </div>

        <nav style={styles.nav}>
          <Link href="/dashboard" style={styles.link}>Dashboard</Link>
          <Link href="/pricing" style={styles.link}>Pricing</Link>
        </nav>

        <a href="/register" onClick={handleStartFree} style={styles.cta}>Start Free</a>
      </header>

      <main style={styles.container}>
        <h1 style={styles.title}>Purchase a subscription</h1>
        <p style={styles.subtitle}>
          Choose the appropriate plan based on the number of words you need to Humanize AI text.
        </p>

        <div style={styles.toggleWrap}>
          <div style={styles.toggle}>
            <button
              onClick={() => setBilling("monthly")}
              style={{ ...styles.toggleBtn, ...(billing === "monthly" ? styles.toggleActive : {}) }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling("yearly")}
              style={{ ...styles.toggleBtn, ...(billing === "yearly" ? styles.toggleActive : {}) }}
            >
              Yearly <span style={styles.savePill}>Save up to 60%</span>
            </button>
          </div>
        </div>

        <div style={styles.grid}>
          {plans.map((p) => (
            <div key={p.name} style={{ ...styles.card, ...(p.highlight ? styles.cardHighlight : {}) }}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.planName}>{p.name}</div>
                  <div style={styles.planWords}>{p.words}</div>
                </div>
                <div style={styles.saveBadge}>{p.save}</div>
              </div>

              <div style={styles.priceRow}>
                <div style={styles.price}>
                  ${billing === "monthly" ? p.monthly : Math.round(p.yearly / 12)}
                </div>
                <div style={styles.priceMeta}>
                  <div>Per month,</div>
                  <div style={{ opacity: 0.85 }}>
                    Billed ${billing === "monthly" ? p.monthly * 12 : p.yearly} Annually
                  </div>
                </div>
              </div>

              <button
                style={{ ...styles.buyBtn, ...(p.highlight ? styles.buyBtnHot : {}) }}
                onClick={() => {
                  // later you’ll connect Stripe here
                  // for now: after any click, go back dashboard (as you asked)
                  router.push("/dashboard");
                }}
              >
                {p.button}
              </button>

              <ul style={styles.list}>
                {p.features.map((f) => (
                  <li key={f} style={styles.li}>✓ {f}</li>
                ))}
                {p.notIncluded?.map((n) => (
                  <li key={n} style={{ ...styles.li, opacity: 0.55 }}>✕ {n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg,#0b1020,#070a14)",
    color: "#e8eaf1",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  },
  topbar: {
    position: "sticky",
    top: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 22px",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    background: "rgba(10,12,24,.75)",
    backdropFilter: "blur(10px)",
    zIndex: 10,
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
    boxShadow: "0 10px 24px rgba(139,92,246,.25)",
  },
  nav: { display: "flex", gap: 14, alignItems: "center" },
  link: { color: "#cfd3e6", textDecoration: "none", opacity: 0.9 },
  cta: {
    color: "#0b1020",
    background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
    padding: "10px 14px",
    borderRadius: 12,
    textDecoration: "none",
    fontWeight: 700,
  },
  container: { maxWidth: 1100, margin: "0 auto", padding: "48px 18px 70px" },
  title: { textAlign: "center", fontSize: 46, margin: 0, letterSpacing: -0.5 },
  subtitle: { textAlign: "center", marginTop: 10, opacity: 0.75, lineHeight: 1.6 },
  toggleWrap: { display: "flex", justifyContent: "center", marginTop: 26 },
  toggle: {
    display: "flex",
    gap: 6,
    padding: 6,
    borderRadius: 999,
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  toggleBtn: {
    border: "none",
    background: "transparent",
    color: "#cfd3e6",
    padding: "10px 16px",
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 700,
  },
  toggleActive: {
    background: "rgba(139,92,246,.25)",
    color: "#fff",
    boxShadow: "0 10px 22px rgba(139,92,246,.15)",
  },
  savePill: {
    marginLeft: 8,
    fontSize: 12,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,.10)",
    border: "1px solid rgba(255,255,255,.12)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 18,
    marginTop: 30,
  },
  card: {
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.10)",
    borderRadius: 22,
    padding: 22,
    boxShadow: "0 18px 60px rgba(0,0,0,.35)",
  },
  cardHighlight: {
    background: "linear-gradient(180deg, rgba(139,92,246,.25), rgba(255,255,255,.04))",
    border: "1px solid rgba(139,92,246,.35)",
  },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between" },
  planName: { fontSize: 26, fontWeight: 800 },
  planWords: { marginTop: 6, opacity: 0.8 },
  saveBadge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.10)",
    border: "1px solid rgba(255,255,255,.12)",
    opacity: 0.9,
  },
  priceRow: { display: "flex", gap: 16, alignItems: "baseline", marginTop: 18 },
  price: { fontSize: 54, fontWeight: 900, letterSpacing: -1 },
  priceMeta: { opacity: 0.8, lineHeight: 1.35 },
  buyBtn: {
    width: "100%",
    marginTop: 16,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.12)",
    background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  buyBtnHot: {
    background: "linear-gradient(135deg,#ff3d5a,#ff7a18)",
  },
  list: { marginTop: 18, paddingLeft: 0, listStyle: "none", lineHeight: 1.9, opacity: 0.92 },
  li: { fontSize: 14 },
};