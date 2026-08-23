import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://ashumanizer.com"),
  title: {
    default:
      "AI Humaniser (AI Humanizer) – Humanize AI Text Free | Ashumanizer",
    template: "%s | Ashumanizer",
  },
  description:
    "Ashumanizer is an AI Humaniser (AI Humanizer) that rewrites ChatGPT, Gemini, and other AI-generated text into natural, clear, human-sounding writing. Try it free.",
  keywords: [
    "AI humaniser",
    "AI humanizer",
    "humanize AI text",
    "AI to human text converter",
    "humanize ChatGPT text",
    "free AI humanizer",
    "free AI humaniser",
    "AI text humanizer",
  ],
  openGraph: {
    title: "AI Humaniser (AI Humanizer) – Humanize AI Text Free | Ashumanizer",
    description:
      "Ashumanizer is an AI Humaniser that rewrites AI-generated content into natural, clear, human-sounding writing.",
    url: "https://ashumanizer.com",
    siteName: "Ashumanizer",
    type: "website",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 1200,
        alt: "Ashumanizer — AI Humaniser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Humaniser (AI Humanizer) – Humanize AI Text Free | Ashumanizer",
    description:
      "Ashumanizer is an AI Humaniser that rewrites AI-generated content into natural, clear, human-sounding writing.",
    images: ["/logo.png"],
  },
  alternates: {
    canonical: "https://ashumanizer.com",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
