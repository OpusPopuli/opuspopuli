import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3200";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/petition/",
          "/region/",
          "/settings/",
          "/onboarding",
          "/auth/",
          "/forgot-password",
          "/reset-password",
          "/rag-demo",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
