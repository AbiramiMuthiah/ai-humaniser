import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep private/authenticated app screens out of the crawl —
        // there's no SEO value in Google indexing a logged-in dashboard,
        // and it can dilute relevance signals for your actual marketing pages.
        disallow: ["/dashboard", "/texts"],
      },
    ],
    sitemap: "https://ashumanizer.com/sitemap.xml",
  };
}
