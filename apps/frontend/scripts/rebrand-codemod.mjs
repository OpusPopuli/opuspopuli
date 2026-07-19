#!/usr/bin/env node
/*
 * Sunflower rebrand codemod.
 *
 * Pass A — map old color / shadow / radius utilities to semantic brand tokens.
 * Pass B — strip `dark:` variants that now flip automatically via the tokens.
 *
 * Conservative by design: only clearly-safe structural maps are automated.
 * Ambiguous cases that risk the gold-on-paper WCAG trap (sage-as-text, other
 * accent-colored text, `text-white` on buttons, multi-color icon tiles) are
 * NOT rewritten — they are printed to a report for hand review.
 *
 * Usage:
 *   node scripts/rebrand-codemod.mjs           # dry-run (report only)
 *   node scripts/rebrand-codemod.mjs --apply   # write changes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");

// Files whose color usage is remapped by hand (lookup maps / bespoke chrome).
const EXCLUDE = [
  "components/StatusPill.tsx",
  "components/ui/",
  "components/brand/",
];

// Ordered Pass-A replacements. `old` is matched as a whole class token with an
// optional variant chain (hover:, md:, dark:, group-hover:, …) and optional
// `/opacity` suffix, both preserved.
const MAP = [
  // primary text (ink)
  ["text-[#222222]", "text-content"],
  ["text-[#1a1a1a]", "text-content"],
  ["text-[#1A1A1A]", "text-content"],
  // secondary text
  ["text-[#4d4d4d]", "text-content-dim"],
  ["text-[#4D4D4D]", "text-content-dim"],
  ["text-[#595959]", "text-content-dim"],
  ["text-[#334155]", "text-content-dim"],
  ["text-[#444444]", "text-content-dim"],
  ["text-[#767676]", "text-content-dim"],
  // slate greys (info/meta text) → dim
  ["text-[#94a3b8]", "text-content-dim"],
  ["text-[#6b7280]", "text-content-dim"],
  ["text-[#64748b]", "text-content-dim"],
  ["text-[#475569]", "text-content-dim"],
  // sage-as-text → neutral content (never gold text on paper — AA trap)
  ["text-[#5A7A6A]", "text-content"],
  ["text-[#5a7a6a]", "text-content"],
  ["text-[#2D4A3C]", "text-content"],
  ["text-[#2d4a3c]", "text-content"],
  // dark panels / inverse
  ["bg-[#222222]", "bg-inverse-surface"],
  ["bg-[#333333]", "bg-inverse-surface"],
  ["border-[#222222]", "border-content"],
  // rings — dark ring → neutral content (flips); sage ring → gold (earned)
  ["ring-[#222222]", "ring-content"],
  ["ring-[#5A7A6A]", "ring-accent"],
  ["ring-[#5a7a6a]", "ring-accent"],
  // sage accent borders → gold accent border (selection/active — earned)
  ["border-[#5A7A6A]", "border-accent"],
  ["border-[#5a7a6a]", "border-accent"],
  // sage CTA (the one earned gold fill) → gold
  ["bg-[#5A7A6A]", "bg-accent"],
  ["bg-[#5a7a6a]", "bg-accent"],
  ["bg-[#2D4A3C]", "bg-accent"],
  ["bg-[#4A6A5A]", "bg-accent-strong"],
  ["bg-[#4a6a5a]", "bg-accent-strong"],
  // sage-light tint bg / icon → neutral (gold is rationed, not a tint)
  ["bg-[#7F9C8E]", "bg-surface-alt"],
  ["bg-[#7f9c8e]", "bg-surface-alt"],
  ["text-[#7F9C8E]", "text-content-dim"],
  ["text-[#7f9c8e]", "text-content-dim"],
  // gray/white neutrals → surfaces
  ["bg-white", "bg-surface"],
  ["bg-[#FFFFFF]", "bg-surface"],
  ["bg-[#ffffff]", "bg-surface"],
  ["bg-[#fafafa]", "bg-surface-alt"],
  ["bg-gray-50", "bg-surface-alt"],
  ["bg-gray-100", "bg-surface-alt"],
  ["bg-gray-200", "bg-surface-sunk"],
  ["bg-[#DDDDDD]", "bg-surface-sunk"],
  ["bg-gray-800", "bg-inverse-surface"],
  ["bg-gray-900", "bg-inverse-surface"],
  // borders
  ["border-[#DDDDDD]", "border-line"],
  ["border-[#dddddd]", "border-line"],
  ["border-gray-100", "border-line"],
  ["border-gray-200", "border-line"],
  ["border-gray-300", "border-line"],
  ["border-gray-700", "border-line"],
  ["border-gray-800", "border-line"],
  // gray text
  ["text-gray-400", "text-content-dim"],
  ["text-gray-500", "text-content-dim"],
  ["text-gray-600", "text-content-dim"],
  ["text-gray-700", "text-content"],
  ["text-gray-800", "text-content"],
  ["text-gray-900", "text-content"],
  // radius normalization (brand uses rounded-lg)
  ["rounded-xl", "rounded-lg"],
  ["rounded-2xl", "rounded-lg"],
  ["rounded-3xl", "rounded-lg"],
];

// Regex rules — applied after exact MAP. Sage was the OLD accent, used
// liberally; the new brand rations gold, so sage defaults to NEUTRAL (warm
// surfaces/borders), never gold. Focus/selection rings become gold (earned).
// `$1` is the preserved variant chain.
const RULES = [
  [/((?:[\w-]+:)*)bg-sage[\w-]*(?:\/\d+)?/g, "$1bg-surface-alt"],
  [/((?:[\w-]+:)*)text-sage[\w-]*(?:\/\d+)?/g, "$1text-content"],
  [/((?:[\w-]+:)*)border-sage[\w-]*(?:\/\d+)?/g, "$1border-line"],
  [/((?:[\w-]+:)*)ring-sage[\w-]*(?:\/\d+)?/g, "$1ring-accent"],
];

// Semantic utilities whose `dark:` variant is redundant (base flips already).
const DARK_STRIP = [
  "bg-surface",
  "bg-surface-alt",
  "bg-surface-sunk",
  "bg-inverse-surface",
  "text-content",
  "text-content-dim",
  "border-line",
  "border-content",
  "text-white",
  "bg-gray-700",
  "bg-gray-800",
  "bg-gray-900",
  "text-gray-200",
  "text-gray-300",
  "text-gray-400",
  "border-gray-700",
];

// Patterns flagged for HAND review (never auto-rewritten).
const FLAGS = [
  [
    "accent-as-text (AA trap)",
    /(?<![\w-])(?:[\w-]+:)*text-\[#(5A7A6A|5a7a6a|7F9C8E|7f9c8e|2D4A3C|2d4a3c)\]/g,
  ],
  [
    "remaining raw hex",
    /(?<![\w-])(?:[\w-]+:)*(?:text|bg|border|ring|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g,
  ],
  [
    "sage utility",
    /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|ring|from|to)-sage[\w-]*/g,
  ],
  [
    "multi-color tile (blue/green/purple)",
    /(?<![\w-])(?:[\w-]+:)*bg-(blue|green|purple|indigo|pink)-\d{2,3}/g,
  ],
  [
    "shadow (should be hairline)",
    /(?<![\w-])(?:[\w-]+:)*shadow(-\[[^\]]*\]|-(sm|md|lg|xl|2xl))?/g,
  ],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DELIM_BEFORE = `(?<=^|[\\s"'\`{(])`;
const DELIM_AFTER = `(?=$|[\\s"'\`})])`;

// Remove shadow utilities entirely (brand carries depth with hairlines only).
const SHADOW_RE = new RegExp(
  `${DELIM_BEFORE}(?:[\\w-]+:)*shadow(?:-\\[[^\\]]*\\]|-(?:sm|md|lg|xl|2xl|inner|none))? ?`,
  "g",
);

function applyPassA(text) {
  let out = text;
  for (const [oldTok, newTok] of MAP) {
    const re = new RegExp(
      `${DELIM_BEFORE}((?:[\\w-]+:)*)${esc(oldTok)}(/\\d+)?${DELIM_AFTER}`,
      "g",
    );
    out = out.replace(
      re,
      (_m, variants, opacity) => `${variants}${newTok}${opacity || ""}`,
    );
  }
  for (const [reBody, repl] of RULES) {
    const re = new RegExp(`${DELIM_BEFORE}${reBody.source}${DELIM_AFTER}`, "g");
    out = out.replace(re, repl);
  }
  out = out.replace(SHADOW_RE, "");
  return out;
}

// Any `dark:` variant targeting a neutral (gray/slate/zinc/neutral/stone shade,
// or white/black). After Pass A the base is a semantic token that already flips,
// so these dark overrides fight the flip and must go. Semantic status colours
// (blue/red/green/yellow…) are intentionally NOT matched — they stay.
const DARK_NEUTRAL_RE = new RegExp(
  `${DELIM_BEFORE}dark:(?:[\\w-]+:)*(?:bg|text|border|placeholder|ring|divide|from|to)-` +
    `(?:(?:gray|slate|zinc|neutral|stone)-\\d{2,3}|white|black)(?:/\\d+)?(?![\\w-]) ?`,
  "g",
);

function applyPassB(text) {
  let out = text;
  for (const util of DARK_STRIP) {
    // Remove a `dark:` token (with any nested variants) ending in this utility,
    // plus one adjacent space. The `(?![\w-])` boundary is critical so a short
    // utility (bg-surface, text-content) does NOT strip a longer one
    // (bg-surface-alt, text-content-dim) as a prefix.
    const re = new RegExp(
      `${DELIM_BEFORE}dark:(?:[\\w-]+:)*${esc(util)}(?:/\\d+)?(?![\\w-]) ?`,
      "g",
    );
    out = out.replace(re, "");
  }
  out = out.replace(DARK_NEUTRAL_RE, "");
  return out;
}

// Within a SINGLE className that paints an inverse (always-opposite-theme)
// surface, fixed light text must flip with the panel — otherwise it reads
// light-on-light in dark mode. Only same-string (same element) is touched;
// split parent/child panels are left for the manual .on-ink visual pass.
function fixInverseText(value) {
  if (!value.includes("bg-inverse-surface")) return value;
  return value
    .replace(/(?<![\w-])text-white(?![\w-])/g, "text-on-inverse")
    .replace(
      /(?<![\w-])text-gray-(100|200|300|400)(?![\w-])/g,
      "text-on-inverse",
    );
}

function inverseText(text) {
  text = text.replace(
    /className="([^"]*)"/g,
    (_m, v) => `className="${fixInverseText(v)}"`,
  );
  text = text.replace(
    /className=\{`([^`$]*)`\}/g,
    (_m, v) => `className={\`${fixInverseText(v)}\`}`,
  );
  return text;
}

// Normalize whitespace inside className string values left by token removal
// (leading/trailing spaces, doubled spaces). Only plain string / non-interpolated
// template values are touched; anything with ${…} is left alone.
function tidy(text) {
  text = text.replace(
    /className="([^"]*)"/g,
    (_m, v) => `className="${v.replace(/\s+/g, " ").trim()}"`,
  );
  text = text.replace(
    /className=\{`([^`$]*)`\}/g,
    (_m, v) => `className={\`${v.replace(/\s+/g, " ").trim()}\`}`,
  );
  return text;
}

function listFiles() {
  // NB: `git ls-files 'app/**/*.tsx'` misses top-level files (git ** needs an
  // intermediate dir). List everything and filter in JS instead.
  const raw = execSync("git ls-files", {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return raw
    .split("\n")
    .filter(Boolean)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => f.startsWith("app/") || f.startsWith("components/"))
    .filter((f) => !EXCLUDE.some((e) => f.startsWith(e) || f === e));
}

let changed = 0;
const report = {};
for (const file of listFiles()) {
  const before = readFileSync(file, "utf8");
  const after = tidy(inverseText(applyPassB(applyPassA(before))));
  if (after !== before) {
    changed++;
    if (APPLY) writeFileSync(file, after);
  }
  for (const [label, re] of FLAGS) {
    const hits = after.match(re);
    if (hits) report[label] = (report[label] || 0) + hits.length;
  }
}

console.log(
  `${APPLY ? "APPLIED" : "DRY-RUN"} — ${changed} files ${APPLY ? "rewritten" : "would change"}`,
);
console.log("\nHand-review flags remaining after Pass A/B:");
for (const [label, count] of Object.entries(report)) {
  console.log(`  ${count.toString().padStart(4)}  ${label}`);
}
if (!Object.keys(report).length) console.log("  (none)");
