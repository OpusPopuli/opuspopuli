"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RegionPageHeader } from "@/components/region/RegionPageHeader";

export interface LayerPageShellProps {
  readonly levelLabel: string;
  readonly gold?: boolean;
  readonly name: string;
  readonly meta?: string | null;
  /** "Who governs here" detail — seats, threshold, whatever the level has. */
  readonly header?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The shell every layer page shares (#1195–#1197).
 *
 * Two parts in a fixed order — who governs here, then what's here — so the
 * level is the only variable and a reader who has read one page can read the
 * others. Gold marks the county and nothing else; it is wayfinding, and the
 * level label carries the same information in words (WCAG 1.4.1).
 */
export function LayerPageShell({
  levelLabel,
  gold,
  name,
  meta,
  header,
  children,
}: LayerPageShellProps) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      {/* The trail supplies root + layer from the pathname; on a layer page
          the layer IS the location, so no tail segment is passed. */}
      <RegionPageHeader title={name} />

      <span
        className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
          gold ? "bg-accent text-on-accent" : "bg-surface-sunk text-content-dim"
        }`}
      >
        {levelLabel}
      </span>
      {meta && <p className="mt-2 text-content-dim">{meta}</p>}

      {header}

      <div className="mt-10">{children}</div>
    </div>
  );
}

/** A titled block inside "what's here". */
export function LayerSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="border-b border-content pb-2 text-xs font-bold uppercase tracking-wider text-content-dim">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One row of "what happened". Same anatomy at every level — badge, what,
 * when — so scanning transfers between pages and is learned once.
 */
export function ActivityRow({
  badge,
  what,
  sub,
  when,
  href,
}: {
  readonly badge?: string;
  readonly what: string;
  readonly sub?: string | null;
  readonly when?: string | null;
  readonly href?: string;
}) {
  const body = (
    <div className="flex items-start gap-3 py-3">
      {badge && (
        <span className="mt-0.5 shrink-0 rounded bg-surface-sunk px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-content-dim">
          {badge}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-content">{what}</p>
        {sub && <p className="mt-0.5 text-sm text-content-dim">{sub}</p>}
      </div>
      {when && (
        <span className="shrink-0 text-xs text-content-dim">{when}</span>
      )}
    </div>
  );
  return (
    <div className="border-b border-line last:border-b-0">
      {href ? (
        // prefetch={false} because these rows point at entity detail routes
        // (/region/bills/[id] and friends) and they render as a list — the
        // exact prefetch storm #1174 fixed. The repo's link-prefetch guard
        // cannot catch this one: the href arrives as a prop, so there is no
        // dynamic literal in the page for it to scan.
        <Link
          href={href}
          prefetch={false}
          className="block hover:bg-surface-alt"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** A door with a count on it, for the type index. */
export function IndexRow({
  label,
  description,
  count,
  href,
}: {
  readonly label: string;
  readonly description?: string | null;
  readonly count?: ReactNode;
  readonly href?: string;
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="font-semibold text-content">{label}</span>
        {description && (
          <span className="ml-2 text-sm text-content-dim">{description}</span>
        )}
      </span>
      <span className="shrink-0 text-sm text-content-dim">{count}</span>
    </div>
  );
  return (
    <div className="border-b border-line last:border-b-0">
      {href ? (
        <Link href={href} className="block hover:bg-surface-alt">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** The Building tag, reused from onboarding's Live/Building vocabulary. */
export function BuildingTag({ label }: { readonly label: string }) {
  return (
    <span className="rounded border border-warning-line bg-warning-surface px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-warning">
      {label}
    </span>
  );
}
