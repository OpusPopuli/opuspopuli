/**
 * Symmetry evaluation — R3's second exit criterion (#1142).
 *
 * Generates an analysis for each member of a mirrored pair and asks whether
 * equivalent material was treated equivalently. See `scoring/symmetry.ts` for
 * why the metrics are style features rather than a political-valence lexicon,
 * and why the within-measure yes/no comparison is the one to trust first.
 *
 * Three readings come out, in descending order of how much weight they bear:
 *
 *   1. **Within-measure yes/no symmetry**, across every measure. Content is
 *      controlled — same measure, same prompt, same run — so a systematic gap
 *      is treatment. This needs no pair fixture and is the strongest signal.
 *   2. **The control pair.** Two near-identical filings should come out
 *      symmetric. If they do not, the metric is noisy and everything below is
 *      untrustworthy — so it is reported before the real pairs, not after.
 *   3. **Paired cross-pair differences.** Weakest. One pair proves nothing;
 *      only a consistent SIGN across pairs is evidence.
 *
 * Usage:
 *   PROMPT_SERVICE_URL=... PROMPT_SERVICE_API_KEY=... \
 *     pnpm --filter @opuspopuli/eval-harness eval:symmetry -- \
 *       --model qwen3.5:9b --no-think [--pairs redistricting-two-responses]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DbService } from "@opuspopuli/relationaldb-provider";

import { assertFreshBuilds } from "./build-freshness.js";
import {
  probeModel,
  describeProvenance,
  slugFor,
  assertThinkDecided,
  type ModelProvenance,
} from "./provenance.js";
import { resolveAnalysisPrompt } from "./prompt-attribution.js";
import { createLlmBackend } from "./backends/llm.js";
import { scoreJsonValidity } from "./scoring/json-validity.js";
import {
  scoreYesNoSymmetry,
  comparePairTreatment,
  summarizePairedDifferences,
  type PairTreatment,
  type SymmetryComparison,
} from "./scoring/symmetry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

interface Side {
  externalId: string;
  label: string;
}

interface Pair {
  id: string;
  axis: string;
  control?: boolean;
  a: Side;
  b: Side;
  notes?: string;
}

interface SourceItem {
  externalId: string;
  title: string;
  fullText: string;
  chars: number;
}

/** Same formatting as production, so offsets and content match what ships. */
function formatPropData(item: SourceItem): string {
  return [
    `ExternalId: ${item.externalId}`,
    `Title: ${item.title}`,
    "",
    "FullText:",
    item.fullText,
  ].join("\n");
}

export interface YesNoResult {
  externalId: string;
  comparison: SymmetryComparison;
}

function reportYesNo(rows: YesNoResult[]): string[] {
  const lines = [
    "",
    "── Within-measure yes/no symmetry (content controlled — trust this first)",
    "",
    "measure       yes words  no words  ratio   hedge Δ/100w  flags",
  ];
  for (const r of rows) {
    const c = r.comparison;
    lines.push(
      [
        r.externalId.padEnd(13),
        String(c.a.words).padStart(9),
        String(c.b.words).padStart(10),
        c.lengthRatio.toFixed(2).padStart(7),
        c.hedgeDelta.toFixed(2).padStart(13),
        `  ${c.flags.length ? c.flags.join("; ") : "—"}`,
      ].join(""),
    );
  }

  const ratios = rows.map((r) => r.comparison.lengthRatio);
  const deltas = rows.map((r) => r.comparison.hedgeDelta);
  const yesLonger = rows.filter(
    (r) => r.comparison.a.words > r.comparison.b.words,
  ).length;
  const mean = (xs: number[]): number =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

  lines.push(
    "",
    `mean length ratio ${mean(ratios).toFixed(3)}  |  mean hedge Δ ${mean(deltas).toFixed(2)}/100w  |  ` +
      `yes longer on ${yesLonger}/${rows.length}`,
    // A near-even split is the null. A consistent lean is the finding, and
    // saying so here stops a single row being read as a result.
    yesLonger === rows.length || yesLonger === 0
      ? "  ^ CONSISTENT LEAN — every measure favours the same side on length."
      : "  ^ split across measures; no consistent lean on length.",
  );
  return lines;
}

async function main(): Promise<void> {
  assertFreshBuilds();

  const argv = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const model = arg("model") ?? process.env.LLM_MODEL ?? "qwen3.5:9b";
  const think = argv.includes("--think");
  const thinkWasExplicit =
    argv.includes("--think") || argv.includes("--no-think");
  const only = arg("pairs");

  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/symmetry-pairs.json"), "utf8"),
  ) as { pairs: Pair[] };
  const source = JSON.parse(
    readFileSync(join(ROOT, "fixtures/symmetry-sources.json"), "utf8"),
  ) as { items: SourceItem[] };

  const pairs = only
    ? fixture.pairs.filter((p) => p.id === only)
    : fixture.pairs;
  const byId = new Map(source.items.map((i) => [i.externalId, i]));

  const missing = pairs
    .flatMap((p) => [p.a.externalId, p.b.externalId])
    .filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `symmetry-sources.json is missing: ${[...new Set(missing)].join(", ")}. ` +
        "Rebuild it with: pnpm --filter @opuspopuli/eval-harness fixtures:symmetry",
    );
  }

  const provenance: ModelProvenance = await probeModel(model);
  assertThinkDecided(provenance, thinkWasExplicit);
  const backend = createLlmBackend({ model, think });

  const db = new DbService();
  const payloads = new Map<string, Record<string, unknown>>();
  const yesNo: YesNoResult[] = [];
  let promptHash = "";
  let promptVersion = "";
  let templateName = "";

  try {
    const needed = [
      ...new Set(pairs.flatMap((p) => [p.a.externalId, p.b.externalId])),
    ];
    for (const id of needed) {
      const item = byId.get(id)!;
      const prompt = await resolveAnalysisPrompt(
        db,
        "proposition-analysis",
        formatPropData(item),
      );
      promptHash = prompt.promptHash;
      promptVersion = prompt.promptVersion;
      templateName = prompt.templateName;

      process.stderr.write(`${id} (${item.chars} chars) ... `);
      const run = await backend.generate(prompt.promptText);
      const json = scoreJsonValidity({
        text: run.text,
        finishReason: run.finishReason,
        tokensOut: run.tokensOut,
        maxTokens: run.maxTokens,
      });
      process.stderr.write(`${json.verdict} ${(run.ms / 1000).toFixed(0)}s\n`);

      if (!json.valid || !json.payload) {
        // A pair with an unusable side cannot be compared. Say so rather than
        // comparing against an empty payload, which would read as a huge
        // asymmetry caused by the model rather than by the failure.
        console.error(
          `  ${id}: ${json.verdict} — pair comparisons will skip it`,
        );
        continue;
      }
      payloads.set(id, json.payload);
      yesNo.push({
        externalId: id,
        comparison: scoreYesNoSymmetry(json.payload),
      });
    }
  } finally {
    await db.$disconnect().catch(() => undefined);
  }

  const treatments: PairTreatment[] = [];
  const skipped: string[] = [];
  for (const p of pairs) {
    const a = payloads.get(p.a.externalId);
    const b = payloads.get(p.b.externalId);
    if (!a || !b) {
      skipped.push(p.id);
      continue;
    }
    treatments.push(comparePairTreatment(p.id, a, b, p.a.label, p.b.label));
  }

  const controlIds = new Set(pairs.filter((p) => p.control).map((p) => p.id));
  const control = treatments.filter((t) => controlIds.has(t.pairId));
  const real = treatments.filter((t) => !controlIds.has(t.pairId));
  const paired = summarizePairedDifferences(real);

  const lines = [
    `${describeProvenance(provenance)} digest=${provenance.digest}`,
    `prompt=${templateName} ${promptVersion} hash=${promptHash.slice(0, 12)}`,
    `pairs=${treatments.length} (${control.length} control), measures=${payloads.size}`,
    ...reportYesNo(yesNo),
    "",
    "── Control pair (near-identical filings — must come out symmetric)",
    "",
  ];

  for (const c of control) {
    lines.push(
      `${c.pairId}: length ratio ${c.summary.lengthRatio.toFixed(2)}, ` +
        `hedge Δ ${c.summary.hedgeDelta.toFixed(2)}/100w, ` +
        `provisions ${c.provisionsA} vs ${c.provisionsB}`,
      c.summary.flags.length
        ? `  ^ FLAGGED — the metric fires on near-identical input, so readings below are not trustworthy: ${c.summary.flags.join("; ")}`
        : "  ^ clean — the metric does not fire on near-identical input",
    );
  }

  lines.push(
    "",
    "── Mirrored pairs (weakest reading — a consistent SIGN is the finding, never one pair)",
    "",
    "pair                              ratio   hedge Δ/100w  provisions  flags",
  );
  for (const t of real) {
    lines.push(
      [
        t.pairId.padEnd(33),
        t.summary.lengthRatio.toFixed(2).padStart(6),
        t.summary.hedgeDelta.toFixed(2).padStart(13),
        `   ${t.provisionsA} vs ${t.provisionsB}`.padEnd(12),
        `  ${t.summary.flags.length ? t.summary.flags.join("; ") : "—"}`,
      ].join(""),
    );
  }

  lines.push(
    "",
    `paired: n=${paired.pairs}  mean hedge Δ ${paired.meanHedgeDelta}/100w  ` +
      `mean length ratio ${paired.meanLengthRatio}  ` +
      `same-sign ${paired.sameSignHedge}/${paired.pairs}  flagged ${paired.flagged}`,
    paired.pairs > 0 && paired.sameSignHedge === paired.pairs
      ? "  ^ every pair leans the same way — a systematic lean, not noise."
      : "  ^ signs are split; no systematic lean detectable at this sample size.",
  );

  if (skipped.length) {
    lines.push(
      "",
      `skipped (a side failed to generate): ${skipped.join(", ")}`,
    );
  }

  console.log(`\n${lines.join("\n")}`);

  const out = {
    ranAt: new Date().toISOString(),
    model,
    provenance,
    think,
    prompt: { name: templateName, hash: promptHash, version: promptVersion },
    yesNo,
    control,
    pairs: real,
    paired,
    skipped,
    // Retained so a new metric can be scored without re-running the model.
    payloads: Object.fromEntries(payloads),
  };

  mkdirSync(join(ROOT, "results"), { recursive: true });
  const path = join(
    ROOT,
    "results",
    `symmetry-${slugFor(provenance)}${think ? "-think" : ""}.json`,
  );
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwritten: ${path.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
