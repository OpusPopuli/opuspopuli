import type { MetadataRoute } from "next";
import { CIVIC_SITEMAP_IDS, civicSitemap } from "@/lib/server/civic-sitemap";

/**
 * Rendered per request, not at build (#1456). A build-time sitemap would be
 * whatever the build could read, and CI builds without the gateway: it
 * would ship the fallback, frozen. The reads are edge-cached instead.
 */
export const dynamic = "force-dynamic";

export function generateSitemaps() {
  return CIVIC_SITEMAP_IDS.map((id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  return civicSitemap(await props.id);
}
