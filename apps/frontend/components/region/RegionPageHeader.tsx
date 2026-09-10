"use client";

import type { ReactNode } from "react";
import {
  Breadcrumb,
  type BreadcrumbSegment,
} from "@/components/region/Breadcrumb";

export interface RegionPageHeaderProps {
  /** The tail of the trail. Root and layer are derived from the pathname. */
  readonly segments?: BreadcrumbSegment[];
  /**
   * Rendered as the page's heading. Omit on pages that already render their
   * own persistent heading — passing it there produces two <h1>s with the
   * same text (representative and committee details both do this).
   */
  readonly title?: string;
  /** Descriptive line under the bar. Not pinned — it is context, not location. */
  readonly subtitle?: ReactNode;
  /** Level chip, seats, thresholds — whatever this page's header carries. */
  readonly children?: ReactNode;
}

/**
 * The one header every region page uses: pinned trail + title, with the
 * page's own detail underneath.
 *
 * Before this, each page hand-rolled the same three lines — a `<Breadcrumb>`,
 * then `<div className="mb-8"><h1 className="text-3xl font-bold …">` — eight
 * times over, while the layer pages had grown a fourth variant of their own.
 * They drifted in exactly the way copies do: different type ramps, and only
 * some of them pinned, so the title vanished on scroll depending on which
 * page you were standing on.
 *
 * Only the trail and the title are sticky. Subtitles are descriptive prose;
 * pinning them would eat a third of a phone screen to repeat something the
 * reader has already read.
 */
export function RegionPageHeader({
  segments = [],
  title,
  subtitle,
  children,
}: RegionPageHeaderProps) {
  return (
    <>
      <div className="sticky top-[var(--op-header-h)] z-30 -mx-8 mb-6 border-b border-line bg-surface/85 px-8 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
        <Breadcrumb segments={segments} title={title} />
        {title && (
          <h1 className="mt-1 truncate font-serif text-2xl text-content">
            {title}
          </h1>
        )}
      </div>
      {subtitle && <p className="-mt-2 mb-6 text-content-dim">{subtitle}</p>}
      {children}
    </>
  );
}
