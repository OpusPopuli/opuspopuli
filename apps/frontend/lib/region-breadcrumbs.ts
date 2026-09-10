import { levelSlug, type StackLevel } from "@/lib/region-stack";

/**
 * Which government a region route belongs to.
 *
 * Static, because it is a property of the data a route shows rather than of
 * how the reader arrived — a bills page is state business whether it was
 * reached from the stack, from search, or from a bookmark. Referrer-based
 * trails lie the moment someone shares a link.
 *
 * `/region/meetings` maps to County. An earlier version left it out on the
 * grounds that the table mixes 507 county board meetings with 13 Assembly
 * ones and has no jurisdiction column (#1139), so filing it under County
 * would be a claim we could not support.
 *
 * That conflated two different things. A breadcrumb states where the reader
 * is in the site, not what every row on the page is — and the cost of the
 * confusion was concrete: the county page links to meetings, so a reader
 * following that link lost the county from the trail and had no way back
 * except to the root. Provenance belongs on the rows, which already show
 * their `body`, and the real fix for the mixed corpus is #1139.
 *
 * `/region/search` and `/region/how-it-works` stay unmapped, and those are
 * genuine: search is the axis that cuts across every layer, and the civics
 * explainer belongs to no single government.
 */
const ROUTE_LAYERS: ReadonlyArray<readonly [string, StackLevel]> = [
  ["/region/county", "COUNTY"],
  ["/region/state", "STATE"],
  ["/region/federal", "FEDERAL"],
  ["/region/bills", "STATE"],
  ["/region/propositions", "STATE"],
  ["/region/legislative-committees", "STATE"],
  ["/region/campaign-finance", "STATE"],
  ["/region/representatives", "STATE"],
  ["/region/meetings", "COUNTY"],
];

/** The layer a pathname sits under, or null when it has no honest home. */
export function layerForPath(pathname: string): StackLevel | null {
  for (const [prefix, layer] of ROUTE_LAYERS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return layer;
  }
  return null;
}

/** True when this path IS the layer page, so it isn't linked to itself. */
export function isLayerRoot(pathname: string, layer: StackLevel): boolean {
  return pathname === `/region/${levelSlug(layer)}`;
}
