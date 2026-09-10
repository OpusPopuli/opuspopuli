"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CountyThreshold } from "@/lib/graphql/counties";

export interface CountySwitcherProps {
  readonly counties: readonly CountyThreshold[];
  /** FIPS of the county the reader actually lives in. Never changes. */
  readonly homeFips?: string;
  /** FIPS currently being viewed — the home county unless visiting. */
  readonly selectedFips?: string;
}

/**
 * Pick a county to read about — with the guardrails that keep this from
 * becoming the feature #1105 rejected.
 *
 * "Adopt a county you don't live in" was turned down as astroturf that
 * gamifies places into trophies. A selector is fine; a selector that hands
 * you action affordances somewhere you don't live is that rejected feature
 * wearing a dropdown. So three rules hold here:
 *
 * 1. **Home is permanent.** The reader's own county keeps its badge and its
 *    place at the top of the list in every state. Nothing here changes
 *    where they live — only what they are reading.
 * 2. **Visiting is read-only, and said out loud.** The page renders the
 *    explanation rather than silently thinning out.
 * 3. **Never ordered by threshold.** Sorting 58 counties by fewest
 *    signatures is the "cheapest county" reading with a UI around it, which
 *    the epic's framing constraint forbids: where turnout is low a small
 *    organised group *already governs* — that is the finding, not the
 *    opportunity. The list is alphabetical, full stop.
 */
export function CountySwitcher({
  counties,
  homeFips,
  selectedFips,
}: CountySwitcherProps) {
  const { t } = useTranslation("region");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes and hands focus back to the trigger; a click outside
  // closes without moving focus. Without either, a keyboard reader who
  // opened this had no way out but tabbing through all 58 counties —
  // `components/search/HeaderSearch.tsx` already does this properly and is
  // the pattern being matched.
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  const current =
    counties.find((c) => c.fips === selectedFips) ??
    counties.find((c) => c.fips === homeFips);
  const atHome = current?.fips === homeFips;

  // Alphabetical, with home pinned first. Deliberately NOT by
  // signaturesRequired — see rule 3 above.
  const ordered = [...counties].sort((a, b) => {
    if (a.fips === homeFips) return -1;
    if (b.fips === homeFips) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-content"
      >
        {atHome && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-on-accent">
            {t("switcher.home")}
          </span>
        )}
        {current?.name ?? t("switcher.choose")}
        <span aria-hidden="true" className="text-content-dim">
          ▾
        </span>
      </button>

      {open && (
        <ul
          id={listId}
          className="absolute right-0 z-40 mt-2 max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {ordered.map((c) => (
            <li key={c.fips}>
              <Link
                href={`/region/county?fips=${encodeURIComponent(c.fips)}`}
                prefetch={false}
                onClick={() => close(false)}
                aria-current={c.fips === current?.fips ? "page" : undefined}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content hover:bg-surface-alt"
              >
                {c.fips === homeFips && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-on-accent">
                    {t("switcher.home")}
                  </span>
                )}
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Shown whenever the reader is reading about somewhere they do not live.
 *
 * Disabled-and-explained, never disabled-and-silent: the sections that
 * disappear are the ones built from the reader's own resolved jurisdiction,
 * and a page that just thins out looks broken rather than principled.
 */
export function VisitingNotice({ homeName }: { readonly homeName?: string }) {
  const { t } = useTranslation("region");
  return (
    <p className="mt-6 rounded-lg border border-info-line bg-info-surface px-5 py-4 text-sm leading-relaxed text-info">
      {homeName
        ? t("switcher.visiting", { home: homeName })
        : t("switcher.visitingNoHome")}
    </p>
  );
}
