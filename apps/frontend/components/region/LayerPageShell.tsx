"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RegionPageHeader } from "@/components/region/RegionPageHeader";
import { LevelPill, type StackLevel } from "@/components/region/LevelPill";

export interface LayerPageShellProps {
  readonly level: StackLevel;
  readonly levelLabel: string;
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
  level,
  levelLabel,
  name,
  meta,
  header,
  children,
}: LayerPageShellProps) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <RegionPageHeader
        title={name}
        meta={meta}
        eyebrow={<LevelPill level={level} label={levelLabel} />}
      />

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
    <section className="mt-12 first:mt-0">
      <h2 className="border-b border-content pb-3 text-xs font-bold uppercase tracking-[0.13em] text-content-dim">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A ledger: column headings over a single rule, then rows.
 *
 * The headings ARE the section heading — "What the county did" names the
 * section and labels the column at once, which is why this is not wrapped
 * in a LayerSection. Nesting the two stacked two heavy rules with the
 * column labels trapped between them.
 */
export function Ledger({
  when,
  what,
  children,
}: {
  readonly when: string;
  readonly what: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="grid grid-cols-[7rem_1fr] items-baseline gap-6 border-b border-content pb-3">
        <span className="text-xs font-bold uppercase tracking-[0.13em] text-content-dim">
          {when}
        </span>
        <h2 className="text-xs font-bold uppercase tracking-[0.13em] text-content-dim">
          {what}
        </h2>
      </div>
      {children}
    </section>
  );
}

/**
 * One row of "what happened".
 *
 * The date is a left-hand column rather than a right-aligned tail: dates
 * that share an edge can be compared down the page, and the eye finds the
 * headline at one consistent indent instead of at wherever the previous
 * title happened to wrap.
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
    <div className="grid grid-cols-[7rem_1fr] gap-6 py-5">
      <span className="pt-0.5 text-sm text-content-dim">{when}</span>
      <div className="min-w-0">
        <p className="text-lg leading-snug font-semibold text-content">
          {what}
        </p>
        {(sub || badge) && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-content-dim">
            {badge && (
              <span className="rounded bg-surface-sunk px-2 py-0.5 text-xs font-bold uppercase tracking-wider">
                {badge}
              </span>
            )}
            {sub}
          </p>
        )}
      </div>
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

/**
 * A labelled row whose detail sits hard right — used for the reader's own
 * seats, where the fact is the name and the provenance is secondary.
 */
export function DetailRow({
  label,
  detail,
  strong,
}: {
  readonly label: ReactNode;
  readonly detail?: ReactNode;
  readonly strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4 last:border-b-0">
      <span
        className={
          strong ? "text-lg font-semibold text-content" : "text-content"
        }
      >
        {label}
      </span>
      {detail && <span className="text-sm text-content-dim">{detail}</span>}
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
    <div className="flex items-baseline justify-between gap-4 py-4">
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
        <Link
          // prefetch-ok: index rows point at static section routes; the
          // entity rows are ActivityRow above, which disables prefetch
          href={href}
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

/** The Building tag, reused from onboarding's Live/Building vocabulary. */
export function BuildingTag({ label }: { readonly label: string }) {
  return (
    <span className="rounded border border-warning-line bg-warning-surface px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-warning">
      {label}
    </span>
  );
}
