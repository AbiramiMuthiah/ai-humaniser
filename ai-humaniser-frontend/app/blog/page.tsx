import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides on humanizing AI text, working with ChatGPT and Gemini output, and writing that sounds naturally human.",
};

const posts = [
  {
    slug: "how-to-humanize-chatgpt-text",
    title: "How to Humanize ChatGPT Text",
    excerpt:
      "A practical walkthrough for making ChatGPT output read naturally, without losing your facts or your voice.",
    date: "2026-08-24",
  },
  // Add more posts here as you write them:
  // {
  //   slug: "ai-humanizer-vs-paraphraser",
  //   title: "AI Humanizer vs Paraphraser: What's the Difference?",
  //   excerpt: "...",
  //   date: "2026-09-01",
  // },
];

export default function BlogIndex() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 20px 80px",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <h1 style={{ fontSize: 36, fontWeight: 900, marginBottom: 12 }}>
        Ashumanizer Blog
      </h1>
      <p
        style={{
          color: "rgba(255,255,255,0.7)",
          marginBottom: 40,
          lineHeight: 1.6,
        }}
      >
        Guides on humanizing AI text and writing that actually sounds like you.
      </p>

      <div style={{ display: "grid", gap: 28 }}>
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <article
              style={{
                padding: 20,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
                {post.title}
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.65)",
                  lineHeight: 1.6,
                  marginBottom: 8,
                }}
              >
                {post.excerpt}
              </p>
              <time
                style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}
              >
                {new Date(post.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </article>
          </Link>
        ))}
      </div>
    </main>
  );
}
