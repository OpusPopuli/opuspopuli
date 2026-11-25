import type { MetadataRoute } from "next";
import { getRobotsDisallow } from "@/config/indexing.config.mjs";
import { CIVIC_SITEMAP_IDS } from "@/lib/server/civic-sitemap";

/**
 * The civic record is indexed (#1456); a reader's own areas are not. See
 * config/indexing.config.mjs for what's private and why the auth pages
 * stay crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3200";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: getRobotsDisallow(),
      },
    ],
    sitemap: [
      `${baseUrl}/sitemap.xml`,
      ...CIVIC_SITEMAP_IDS.map((id) => `${baseUrl}/region/sitemap/${id}.xml`),
    ],
  };
}
