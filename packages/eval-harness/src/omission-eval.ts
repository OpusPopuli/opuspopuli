/**
 * Omission evaluation — score a stored generation run for what it left out.
 *
 * Reads payloads a previous `eval:generation` retained, so adding this metric
 * costs an embedding pass rather than another round of inference. See
 * `scoring/omission.ts` for why matching is by meaning and why the threshold
 * is calibrated rather than chosen.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/eval-harness eval:omission -- \
 *     --run results/generation-qwen3-5-9b-Q4-K-M-offsets.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertFreshBuilds } from "./build-freshness.js";
import { slugFor, type ModelProvenance } from "./provenance.js";
import {
  scoreOmission,
  calibrateThreshold,
  type GoldProvision,
  type OmissionScore,
} from "./scoring/omission.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface GoldMeasure {
  externalId: string;
  provisions: GoldProvision[];
}

const cos = (a: number[], b: number[]): number => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};

/**
 * Production's embedding provider, not a reimplementation — the same
 * discipline the retrieval leg follows.
 */
async function embedder(model: string) {
  const mod = await import("@opuspopuli/embeddings-provider");
  const P = (
    mod as unknown as {
      OllamaEmbeddingProvider: new (
        baseUrl?: string,
        model?: string,
        fetchFn?: unknown,
        options?: { taskPrefixes?: boolean },
      ) => { embedDocuments(t: string[]): Promise<number[][]> };
    }
  ).OllamaEmbeddingProvider;
  const p = new P(
    process.env.EMBEDDINGS_OLLAMA_URL ?? "http://localhost:11434",
    model,
    undefined,
    { taskPrefixes: true },
  );
  return (texts: string[]) => p.embedDocuments(texts);
}

/** What the analysis actually offered a reader, as separate statements. */
function emittedStatements(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  push(payload.analysisSummary);
  push(payload.yesOutcome);
  push(payload.noOutcome);
  push(payload.fiscalImpact);
  if (Array.isArray(payload.keyProvisions)) payload.keyProvisions.forEach(push);
  const evp = payload.existingVsProposed as
    | { current?: unknown; proposed?: unknown }
    | undefined;
  push(evp?.current);
  push(evp?.proposed);
  return out;
}

async function main(): Promise<void> {
  assertFreshBuilds();

  const argv = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const runPath =
    arg("run") ?? "results/generation-qwen3-5-9b-Q4-K-M-offsets.json";
  const embedModel = arg("embed-model") ?? "nomic-embed-text-v2-moe:latest";

  const run = JSON.parse(readFileSync(join(ROOT, runPath), "utf8")) as {
    model: string;
    provenance?: ModelProvenance;
    results: Array<{ externalId: string; payload?: Record<string, unknown> }>;
  };
  const goldFixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/gold-provisions.json"), "utf8"),
  ) as { measures: GoldMeasure[] };

  const byId = new Map(run.results.map((r) => [r.externalId, r]));
  const scored = goldFixture.measures.filter(
    (m) => byId.get(m.externalId)?.payload,
  );
  const missing = goldFixture.measures.filter(
    (m) => !byId.get(m.externalId)?.payload,
  );

  if (scored.length === 0) {
    throw new Error(
      `No gold measure in ${runPath} carries a retained payload. Re-run the ` +
        "generation leg (payloads are retained since #1142's omission work):\n" +
        `  pnpm --filter @opuspopuli/eval-harness eval:generation -- --measures ${goldFixture.measures.map((m) => m.externalId).join(",")}`,
    );
  }

  const embed = await embedder(embedModel);

  // Embed every gold provision and every emitted statement once.
  const goldTexts = scored.flatMap((m) => m.provisions.map((p) => p.text));
  const goldOwner = scored.flatMap((m) => m.provisions.map(() => m.externalId));
  const goldVecs = await embed(goldTexts);

  const emittedByMeasure = new Map<string, string[]>();
  for (const m of scored) {
    emittedByMeasure.set(
      m.externalId,
      emittedStatements(byId.get(m.externalId)!.payload!),
    );
  }
  const allEmitted = [...emittedByMeasure.entries()].flatMap(([id, xs]) =>
    xs.map((text) => ({ id, text })),
  );
  const emittedVecs = await embed(allEmitted.map((e) => e.text));

  // Null distribution: gold provisions against statements from OTHER measures,
  // which are known non-matches. The threshold goes above these.
  const negatives: number[] = [];
  for (let g = 0; g < goldTexts.length; g++) {
    for (let e = 0; e < allEmitted.length; e++) {
      if (allEmitted[e].id !== goldOwner[g]) {
        negatives.push(cos(goldVecs[g], emittedVecs[e]));
      }
    }
  }
  const cal = calibrateThreshold(negatives);

  const lines = [
    `run=${runPath}`,
    `model=${run.model} embed=${embedModel}`,
    `threshold ${cal.threshold} (null mean ${cal.nullMean}, p95 ${cal.nullQuantile}, n=${cal.n})`,
    "",
    "measure       provisions  recalled  essential  verdict",
  ];

  const scores: Array<{ externalId: string; score: OmissionScore }> = [];
  let goldOffset = 0;
  for (const m of scored) {
    const emitted = emittedByMeasure.get(m.externalId)!;
    const emittedIdx = allEmitted
      .map((e, i) => (e.id === m.externalId ? i : -1))
      .filter((i) => i >= 0);
    const base = goldOffset;

    const score = scoreOmission(
      m.provisions,
      emitted,
      (g, e) => cos(goldVecs[base + g], emittedVecs[emittedIdx[e]]),
      cal.threshold,
    );
    goldOffset += m.provisions.length;
    scores.push({ externalId: m.externalId, score });

    lines.push(
      [
        m.externalId.padEnd(13),
        String(score.total).padStart(10),
        `${score.recalled} (${(score.recall * 100).toFixed(0)}%)`.padStart(10),
        `${score.essentialRecalled}/${score.essentialTotal}`.padStart(11),
        `  ${score.essentialRecalled < score.essentialTotal ? "DROPPED ESSENTIAL" : "ok"}`,
      ].join(""),
    );
  }

  const tot = scores.reduce(
    (a, s) => ({
      total: a.total + s.score.total,
      recalled: a.recalled + s.score.recalled,
      essentialTotal: a.essentialTotal + s.score.essentialTotal,
      essentialRecalled: a.essentialRecalled + s.score.essentialRecalled,
    }),
    { total: 0, recalled: 0, essentialTotal: 0, essentialRecalled: 0 },
  );

  lines.push(
    "",
    `overall recall    ${tot.recalled}/${tot.total} (${((tot.recalled / tot.total) * 100).toFixed(0)}%)`,
    `ESSENTIAL recall  ${tot.essentialRecalled}/${tot.essentialTotal} (${((tot.essentialRecalled / tot.essentialTotal) * 100).toFixed(0)}%)`,
  );

  const dropped = scores.flatMap((s) =>
    s.score.matches
      .filter((m) => m.essential && !m.recalled)
      .map(
        (m) => `  ${s.externalId} ${m.id} (best ${m.bestScore}) — ${m.text}`,
      ),
  );
  if (dropped.length) {
    lines.push(
      "",
      "essential provisions a voter would not learn about:",
      ...dropped,
    );
  }
  if (missing.length) {
    lines.push(
      "",
      `not scored (no retained payload in this run): ${missing.map((m) => m.externalId).join(", ")}`,
    );
  }

  console.log(`\n${lines.join("\n")}`);

  mkdirSync(join(ROOT, "results"), { recursive: true });
  // Named for the run it scored, as every other leg is. A fixed filename made
  // scoring a second model silently overwrite the first — the only trace of
  // which model the file described was a `model` field inside it, which is the
  // unattributable-result failure this package exists to prevent.
  const slug = run.provenance
    ? slugFor(run.provenance)
    : run.model.replace(/[^a-z0-9]+/gi, "-");
  const out = join(ROOT, "results", `omission-${slug}.json`);
  writeFileSync(
    out,
    `${JSON.stringify({ ranAt: new Date().toISOString(), run: runPath, model: run.model, embedModel, calibration: cal, scores, totals: tot }, null, 2)}\n`,
  );
  console.log(`\nwritten: ${out.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
