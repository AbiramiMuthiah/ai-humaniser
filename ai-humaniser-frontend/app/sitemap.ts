import type { MetadataRoute } from "next";

const BASE_URL = "https://ashumanizer.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/register`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/blog/how-to-humanize-chatgpt-text`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // Add these once you create the pages (Phase 2, steps 8-10 in your plan):
    // {
    //   url: `${BASE_URL}/ai-humanizer`,
    //   lastModified: new Date(),
    //   changeFrequency: "monthly",
    //   priority: 0.9,
    // },
    // {
    //   url: `${BASE_URL}/free-ai-humanizer`,
    //   lastModified: new Date(),
    //   changeFrequency: "monthly",
    //   priority: 0.9,
    // },
    // {
    //   url: `${BASE_URL}/humanize-ai-text`,
    //   lastModified: new Date(),
    //   changeFrequency: "monthly",
    //   priority: 0.9,
    // },
  ];
}