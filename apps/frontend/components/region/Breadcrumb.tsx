"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  isLayerRoot,
  layerForPath,
  type StackLayer,
} from "@/lib/region-breadcrumbs";
import type { UserJurisdictionData } from "@/lib/graphql/region";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import { findByType, findState } from "@/lib/region-stack";

export interface BreadcrumbSegment {
  readonly label: string;
  readonly href?: string;
}

/**
 * The region trail, pinned under the site header.
 *
 * Callers pass only the tail — the part below the layer. The root ("Where
 * you live") and the government the route belongs to are derived from the
 * pathname, so a reader who lands three levels deep can always climb: a bill
 * detail reads Where you live / California / Bills / AB 1157, and every
 * ancestor is a link. Previously the trail skipped the layer entirely, so
 * the only way up from a leaf was the whole way up.
 *
 * A root segment passed by a caller is dropped rather than duplicated, so
 * older call sites keep working while they are migrated.
 *
 * Sticky at --op-header-h with the header's own translucent treatment, so
 * the trail — and, where given, the title — survive scrolling.
 */
/** The reader's own name for a layer — "Sonoma County", "California". */
function layerName(
  layer: StackLayer,
  jurisdictions: readonly UserJurisdictionData[],
): string | undefined {
  if (jurisdictions.length === 0) return undefined;
  if (layer === "county")
    return findByType(jurisdictions, "COUNTY")?.jurisdiction.name;
  if (layer === "state") return findState(jurisdictions)?.name;
  return findByType(jurisdictions, "CONGRESSIONAL_DISTRICT")?.jurisdiction.name;
}

export function Breadcrumb({
  segments,
  title,
}: {
  readonly segments: BreadcrumbSegment[];
  /**
   * The heading RegionPageHeader will render. Passed in only so the trail
   * can drop a final segment that would repeat it — on a layer page the
   * location and the heading are the same jurisdiction.
   */
  readonly title?: string;
}) {
  const pathname = usePathname() ?? "";
  const { t } = useTranslation("region");

  const jurisdictions = useJurisdictions();

  const layer = layerForPath(pathname);
  const trail: BreadcrumbSegment[] = [
    { label: t("stack.title"), href: "/region" },
  ];

  if (layer) {
    // The layer page does not link to itself; it is the current location
    // when no deeper segment follows.
    const onLayerRoot = isLayerRoot(pathname, layer);
    trail.push({
      // The government's own name, not the level word. "Where you live /
      // County" told the reader nothing they did not already know, and the
      // name only appeared in the title — so from a bill three levels down
      // it was invisible. Falls back to the level word while the
      // jurisdictions are still loading, or if none resolved.
      label: layerName(layer, jurisdictions) ?? t(`stack.levels.${layer}`),
      href: onLayerRoot ? undefined : `/region/${layer}`,
    });
  }

  // Tolerate legacy callers that still prepend the root themselves.
  trail.push(...segments.filter((s) => s.href !== "/region"));

  // When the pinned title repeats the last crumb — which is exactly the case
  // on a layer page, where the location and the heading are the same
  // jurisdiction — drop the crumb and let the title be the end of the trail.
  // Otherwise "Where you live / Sonoma County" sits directly above a heading
  // that also says Sonoma County.
  const last = trail[trail.length - 1];
  const titleEndsTheTrail =
    title !== undefined &&
    last !== undefined &&
    last.label === title &&
    !last.href;
  const rendered = titleEndsTheTrail ? trail.slice(0, -1) : trail;

  return (
    <nav aria-label={t("breadcrumb.label")}>
      {rendered.map((segment, i) => (
        <span key={`${segment.label}-${i}`}>
          {i > 0 && (
            <span aria-hidden="true" className="mx-2 text-content-dim">
              /
            </span>
          )}
          {segment.href ? (
            <Link
              href={segment.href}
              className="text-sm text-info hover:text-info-strong hover:underline"
            >
              {segment.label}
            </Link>
          ) : (
            <span
              className="text-sm text-content-dim"
              aria-current={
                !titleEndsTheTrail && i === rendered.length - 1
                  ? "page"
                  : undefined
              }
            >
              {segment.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
