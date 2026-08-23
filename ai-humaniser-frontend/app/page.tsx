import Link from "next/link";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Ashumanizer",
  alternateName: "AI Humaniser",
  url: "https://ashumanizer.com",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Web",
  description:
    "Ashumanizer rewrites AI-generated text so it reads naturally and sounds human-written, while preserving the original meaning.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "48px 20px 80px",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section style={{ textAlign: "center", marginBottom: 56 }}>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 900,
            marginBottom: 16,
            lineHeight: 1.15,
          }}
        >
          AI Humaniser{" "}
          <span style={{ opacity: 0.55, fontWeight: 600, fontSize: 24 }}>
            (AI Humanizer)
          </span>
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "rgba(255,255,255,0.7)",
            maxWidth: 620,
            margin: "0 auto 28px",
          }}
        >
          Ashumanizer is an AI Humaniser that makes AI text sound natural,
          clear, and authentic. Rewrite ChatGPT, Gemini, and other AI-generated
          content into writing a real person would recognize as their own.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/dashboard"
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              background:
                "linear-gradient(135deg, rgba(139,120,255,0.9), rgba(109,93,255,0.9))",
              color: "white",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            Try Ashumanizer Free
          </Link>
          <Link
            href="/pricing"
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.9)",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            See Pricing
          </Link>
        </div>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          What Is an AI Humaniser?
        </h2>
        <p style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
          An AI humaniser (also spelled AI humanizer) rewrites text produced by
          tools like ChatGPT or Gemini so it reads the way a person actually
          writes — varied sentence rhythm, natural word choice, and a voice that
          doesn't sound templated. Ashumanizer does this while keeping every
          fact, number, and citation in your original text exactly as you wrote
          it.
        </p>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          How Ashumanizer Works
        </h2>
        <p style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
          Paste your AI-generated text, choose a tone — standard, professional,
          academic, creative, or casual — and Ashumanizer rewrites it in a
          natural human voice. Every result is checked against an AI-detection
          score so you can see exactly how it reads before you use it.
        </p>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          AI Humaniser Features
        </h2>
        <ul
          style={{
            color: "rgba(255,255,255,0.75)",
            lineHeight: 1.9,
            paddingLeft: 20,
          }}
        >
          <li>Natural rewriting that preserves your original meaning</li>
          <li>
            Multiple writing tones — standard, professional, academic, creative,
            casual
          </li>
          <li>Built-in AI detection scoring on every result</li>
          <li>Free to try, no credit card required</li>
          <li>
            Supports long-form content and file uploads (.txt, .pdf, .docx)
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          Who Uses Ashumanizer?
        </h2>
        <p style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
          Students refining AI-assisted drafts, content writers and bloggers
          polishing AI-generated first passes, and marketers and researchers who
          want their writing to read naturally — without losing their original
          meaning or data.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
          Frequently Asked Questions
        </h2>
        <div style={{ display: "grid", gap: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Is Ashumanizer free?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
              Yes — you can try Ashumanizer without an account, and creating a
              free account gives you a higher daily limit.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Is it "AI Humaniser" or "AI Humanizer"?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
              Both spellings refer to the same thing — "Humaniser" is the
              British spelling and "Humanizer" is the American spelling.
              Ashumanizer works the same either way.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Can I humanize ChatGPT or Gemini text?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
              Yes, Ashumanizer works with text generated by any AI model,
              including ChatGPT, Gemini, Claude, and others.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Will it change my facts or numbers?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
              No — Ashumanizer is built to preserve every number, date, name,
              and citation in your original text exactly as written.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
