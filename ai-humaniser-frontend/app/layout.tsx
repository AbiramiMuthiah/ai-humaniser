import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://ashumanizer.com"),
  title: {
    default: "AI Humanizer – Humanize AI Text Free | Ashumanizer",
    template: "%s | Ashumanizer",
  },
  description:
    "Humanize AI text with Ashumanizer. Rewrite ChatGPT, Gemini, and other AI-generated content into natural, clear, human-sounding writing. Try it free.",
  keywords: [
    "AI humanizer",
    "humanize AI text",
    "AI to human text converter",
    "humanize ChatGPT text",
    "free AI humanizer",
    "AI text humanizer",
  ],
  openGraph: {
    title: "AI Humanizer – Humanize AI Text Free | Ashumanizer",
    description:
      "Humanize AI text with Ashumanizer. Rewrite AI-generated content into natural, clear, human-sounding writing.",
    url: "https://ashumanizer.com",
    siteName: "Ashumanizer",
    type: "website",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 1200,
        alt: "Ashumanizer — AI Humanizer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Humanizer – Humanize AI Text Free | Ashumanizer",
    description:
      "Humanize AI text with Ashumanizer. Rewrite AI-generated content into natural, clear, human-sounding writing.",
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
