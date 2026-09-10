"use client";

import type { StackLevel } from "@/lib/region-stack";
export type { StackLevel };

/**
 * Hue distance from gold tracks jurisdictional distance from the reader.
 *
 * Gold is the county — the near one, the level you can actually act at, and
 * the only level that gets the brand accent. Moving away from gold around
 * the wheel, teal is the state and purple is federal, so the palette itself
 * says "further from you" before a word is read.
 *
 * **Deliberately not blue or red.** They are the two colours Americans read
 * as party the moment they appear on anything shaped like a jurisdiction,
 * and this platform is nonpartisan. Green is avoided too: sitting a green
 * badge next to campaign finance invites a money reading nobody intended.
 *
 * There is no official palette to borrow. No US or California standard maps
 * a level to a colour; seals and flags identify an *entity* rather than a
 * level, and there are 58 county palettes in California alone. So these are
 * ours — taken from the categorical ramps in globals.css, which are already
 * contrast-checked in both themes rather than newly invented hexes.
 *
 * Measured against their own backgrounds: teal 6.07:1 light / 7.64:1 dark,
 * purple 6.77:1 / 7.35:1, gold-on-ink 10.17:1. All clear AA for normal text
 * (4.5:1), which is the bar a 13px bold label has to meet.
 *
 * Colour is never the only carrier: the label states the level in words.
 */
const LEVEL_CLASS: Record<StackLevel, string> = {
  COUNTY: "bg-accent text-on-accent",
  STATE: "bg-cat-teal-surface text-cat-teal",
  FEDERAL: "bg-cat-purple-surface text-cat-purple",
};

export function LevelPill({
  level,
  label,
  size = "md",
}: {
  readonly level: StackLevel;
  readonly label: string;
  readonly size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2 py-0.5" : "px-3 py-1";
  return (
    <span
      className={`inline-block rounded ${pad} text-xs font-bold uppercase tracking-[0.13em] ${LEVEL_CLASS[level]}`}
    >
      {label}
    </span>
  );
}
