"use client";

import type { ReactNode } from "react";
import {
  Breadcrumb,
  type BreadcrumbSegment,
} from "@/components/region/Breadcrumb";

export interface RegionPageHeaderProps {
  /** The tail of the trail. Root and layer are derived from the pathname. */
  readonly segments?: BreadcrumbSegment[];
  /** Sits above the title — the level pill on a layer page. */
  readonly eyebrow?: ReactNode;
  /**
   * Rendered as the page heading. Omit on pages that already render their
   * own persistent heading — representative and committee details both do,
   * and passing it there produced two <h1>s with the same text.
   */
  readonly title?: string;
  /** The line under the title: body, seats, next meeting. */
  readonly meta?: ReactNode;
  readonly children?: ReactNode;
}

/**
 * The one header every region page uses.
 *
 * Order is breadcrumb → eyebrow → title → meta.
 *
 * **Only the breadcrumb is sticky.** An earlier version pinned the title
 * with it, but the pill belongs between the two, and pinning all four would
 * park roughly 180px of chrome on every scroll. The trail alone is what a
 * reader needs to climb from three levels deep; the title is right there at
 * the top of the page they are already on.
 *
 * Before this component the same header was hand-rolled on eight pages,
 * with the layer pages carrying a ninth variant. They had drifted into
 * different type ramps, and only some of them pinned anything.
 */
export function RegionPageHeader({
  segments = [],
  eyebrow,
  title,
  meta,
  children,
}: RegionPageHeaderProps) {
  return (
    <>
      <div className="sticky top-[var(--op-header-h)] z-30 border-b border-line bg-surface/85 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
        <Breadcrumb segments={segments} />
      </div>

      {eyebrow && <div className="mt-8">{eyebrow}</div>}
      {title && (
        <h1 className="mt-5 font-serif text-5xl leading-none text-content">
          {title}
        </h1>
      )}
      {meta && <p className="mt-4 text-lg text-content-dim">{meta}</p>}
      {children}
    </>
  );
}
