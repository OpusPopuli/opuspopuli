/**
 * Representatives eval — what the pipeline produced for the gold reps, scored
 * against `fixtures/gold-representatives.json` (representatives Phase B §4,
 * `docs/plans/representatives-gold-eval.md`).
 *
 * Reads the CURRENT rows from the database rather than running a prompt: the
 * question this answers is "did a pipeline change move what citizens read?",
 * and the rows are what they read. Run it after a sync on the image under
 * test; the gate is no worse than the recorded baseline, per rep.
 *
 * ## Axes (D4) — four, never merged, per rep
 *
 *   recall          gold committees (and counties) the output names
 *   field presence  a field with gold content that came back empty
 *   precision       claims marked `source` that are quotable
 *   labelling       unquotable claims that admit it (`training`)
 *
 * Precision and labelling report "not exercised" until the bio is generated
 * from a source page (#1381) — they are scored against the text the bio was
 * generated FROM, and today that is four structured fields.
 *
 * ## Scope
 *
 * The gold set's tuning pages only. The held-out pair (D6) is excluded unless
 * `--held-out` is passed, and that is to be done once, at the end; neither has
 * a gold page yet, so it reports them as unscored rather than inventing one.
 *
 * ## Usage
 *
 *   pnpm --filter @opuspopuli/eval-harness eval:representatives
 *   pnpm --filter @opuspopuli/eval-harness eval:representatives -- --out <path>
 *   pnpm --filter @opuspopuli/eval-harness eval:representatives -- \
 *     --baseline fixtures/representatives-eval-baseline.json   # the gate
 *
 * Needs DATABASE_URL for the database the sync wrote to (local dev or UAT —
 * never production; the rows are public-figure data, but the habit is the
 * point).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoreCommittees,
  scoreLabelling,
  scoreList,
  type BioClaim,
  type CommitteeRecall,
  type GoldCommittee,
  type LabellingScore,
  type ListRecall,
} from "./scoring/representatives.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Gold fields that list committees, scored against the committee summary. */
const COMMITTEE_FIELDS = [
  "standingCommittees",
  "subcommittees",
  "selectCommittees",
  "jointCommittees",
] as const;

interface GoldField {
  gold: (string | GoldCommittee)[] | null;
}

interface GoldPage {
  rep: string;
  chamber: string;
  district: string;
  fields: Record<string, GoldField>;
}

interface Gold {
  pages: GoldPage[];
  heldOut: { rep: string; chamber: string; district: string }[];
}

/** The columns a rep's outputs live in. */
export interface RepRow {
  name: string;
  bio: string | null;
  bioSource: string | null;
  bioClaims: unknown;
  committeesSummary: string | null;
  bioPromptHash: string | null;
  bioLlmDigest: string | null;
  committeesSummaryPromptHash: string | null;
  committeesSummaryLlmDigest: string | null;
}

export interface RepScore {
  rep: string;
  found: boolean;
  committees?: Record<string, CommitteeRecall>;
  counties?: ListRecall;
  /** Gold fields with content whose output came back empty. */
  emptied: string[];
  labelling?: LabellingScore;
  attribution?: {
    bio: { promptHash: string | null; digest: string | null };
    committeesSummary: { promptHash: string | null; digest: string | null };
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const committeesOf = (field: GoldField | undefined): GoldCommittee[] =>
  (field?.gold ?? []).filter(
    (g): g is GoldCommittee => typeof g === "object" && g !== null,
  );

/** One rep's axes, from its gold page and its stored row. */
export function scoreRep(page: GoldPage, row: RepRow | null): RepScore {
  if (!row) return { rep: page.rep, found: false, emptied: [] };
  const summary = row.committeesSummary ?? "";
  const bio = row.bio ?? "";
  const emptied: string[] = [];

  const committees: Record<string, CommitteeRecall> = {};
  for (const field of COMMITTEE_FIELDS) {
    const gold = committeesOf(page.fields[field]);
    if (gold.length === 0) continue;
    committees[field] = scoreCommittees(gold, summary);
  }
  if (Object.keys(committees).length > 0 && summary.trim() === "") {
    emptied.push("committeesSummary");
  }

  const countyGold = (page.fields.counties?.gold ?? []).filter(
    (g): g is string => typeof g === "string",
  );
  const counties =
    countyGold.length > 0 ? scoreList(countyGold, bio) : undefined;
  if (countyGold.length > 0 && bio.trim() === "") emptied.push("bio");

  return {
    rep: page.rep,
    found: true,
    committees,
    ...(counties && { counties }),
    emptied,
    labelling: scoreLabelling(
      Array.isArray(row.bioClaims) ? (row.bioClaims as BioClaim[]) : [],
      // The text the bio was generated from: none until #1381.
      undefined,
    ),
    attribution: {
      bio: { promptHash: row.bioPromptHash, digest: row.bioLlmDigest },
      committeesSummary: {
        promptHash: row.committeesSummaryPromptHash,
        digest: row.committeesSummaryLlmDigest,
      },
    },
  };
}

/**
 * Where a candidate scores WORSE than the baseline, per rep and field — the
 * gate. Fewer found, a role kept there and lost here, a field emptied. Never
 * an aggregate: a gain on one rep must not pay for a loss on another.
 */
export function regressions(
  candidate: readonly RepScore[],
  baseline: readonly RepScore[],
): string[] {
  return baseline.flatMap((before) => {
    const after = candidate.find((c) => c.rep === before.rep);
    if (!after?.found) {
      return before.found ? [`${before.rep}: no longer found`] : [];
    }
    return [
      ...committeeRegressions(before, after),
      ...countyRegression(before, after),
      ...emptiedRegressions(before, after),
    ];
  });
}

function committeeRegressions(before: RepScore, after: RepScore): string[] {
  return Object.entries(before.committees ?? {}).flatMap(([field, b]) => {
    const a = after.committees?.[field];
    const fewer =
      !a || a.found < b.found
        ? [`${before.rep} / ${field}: ${a?.found ?? 0} < ${b.found}`]
        : [];
    const lost = b.roles
      .filter((role) => role.kept)
      .filter(
        (role) => !a?.roles.find((r) => r.committee === role.committee)?.kept,
      )
      .map((role) => `${before.rep} / ${role.role} of ${role.committee}: lost`);
    return [...fewer, ...lost];
  });
}

function countyRegression(before: RepScore, after: RepScore): string[] {
  if (!before.counties) return [];
  const now = after.counties?.found ?? 0;
  return now < before.counties.found
    ? [`${before.rep} / counties: ${now} < ${before.counties.found}`]
    : [];
}

function emptiedRegressions(before: RepScore, after: RepScore): string[] {
  return after.emptied
    .filter((field) => !before.emptied.includes(field))
    .map((field) => `${before.rep} / ${field}: now empty`);
}

/**
 * Refuse a database that is not on this machine: the eval reads whatever
 * `DATABASE_URL` names, and the habit of never pointing tools at production
 * is enforced here rather than left to a comment. `--allow-remote-db` for a
 * deliberate UAT host.
 */
export function assertLocalDatabase(
  url: string | undefined,
  allowRemote: boolean,
): void {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (allowRemote) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL does not parse");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, not this machine — pass --allow-remote-db to mean it`,
    );
  }
}

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${n}/${d} (${((100 * n) / d).toFixed(1)}%)`;

function printRep(score: RepScore): void {
  console.log(score.rep);
  if (!score.found) {
    console.log("   NOT FOUND in the database — no row by that name\n");
    return;
  }
  for (const [field, r] of Object.entries(score.committees ?? {})) {
    console.log(`   ${field.padEnd(20)} recall ${pct(r.found, r.total)}`);
    if (r.missed.length) console.log(`      missed: ${r.missed.join("; ")}`);
    for (const role of r.roles) {
      console.log(
        `      role ${role.role} of ${role.committee}: ${role.kept ? "kept" : "LOST"}`,
      );
    }
  }
  if (score.counties) {
    console.log(
      `   ${"counties (bio)".padEnd(20)} recall ${pct(score.counties.found, score.counties.total)}`,
    );
  }
  if (score.emptied.length) {
    console.log(`   EMPTY where gold has content: ${score.emptied.join(", ")}`);
  }
  printLabelling(score.labelling);
  console.log();
}

function printLabelling(l: LabellingScore | undefined): void {
  if (!l) return;
  console.log(
    l.exercised
      ? `   precision ${l.precision ?? "n/a"} over ${l.sourceClaims} source claim(s); ` +
          `${l.honestlyLabelled}/${l.unquotable} unquotable labelled training`
      : `   precision/labelling: not exercised — ${l.reason}`,
  );
}

async function main(): Promise<void> {
  const gold = JSON.parse(
    readFileSync(join(ROOT, "fixtures/gold-representatives.json"), "utf8"),
  ) as Gold;
  assertLocalDatabase(process.env.DATABASE_URL, flag("allow-remote-db"));
  const { DbService } = await import("@opuspopuli/relationaldb-provider");
  const db = new DbService();

  const scores: RepScore[] = [];
  try {
    for (const page of gold.pages) {
      const row = (await db.representative.findFirst({
        where: { name: page.rep, chamber: page.chamber, deletedAt: null },
        select: {
          name: true,
          bio: true,
          bioSource: true,
          bioClaims: true,
          committeesSummary: true,
          bioPromptHash: true,
          bioLlmDigest: true,
          committeesSummaryPromptHash: true,
          committeesSummaryLlmDigest: true,
        },
      })) as RepRow | null;
      const score = scoreRep(page, row);
      printRep(score);
      scores.push(score);
    }
  } finally {
    await db.$disconnect();
  }

  console.log(
    flag("held-out")
      ? `held out (D6): ${gold.heldOut.map((h) => h.rep).join(", ")} — no gold page authored, unscored`
      : `held out (D6), not scored: ${gold.heldOut.map((h) => h.rep).join(", ")}`,
  );

  const baselinePath = arg("baseline");
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      reps: RepScore[];
    };
    const worse = regressions(scores, baseline.reps);
    console.log(
      worse.length === 0
        ? `\nno regression against ${baselinePath}`
        : [`\nREGRESSIONS against ${baselinePath}:`, ...worse].join("\n   "),
    );
    if (worse.length > 0) process.exitCode = 1;
  }

  const out = arg("out") ?? join(ROOT, "results", "representatives-eval.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        candidate: "database rows",
        matcher: "content-word containment per sentence",
        reps: scores,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`written: ${out.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
