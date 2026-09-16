/**
 * Throughput baseline — what does concurrency actually buy on this hardware?
 *
 * M6 assumes adversarial review roughly doubles inference, and R7 may argue for
 * a different serving runtime. Both rest on a number nobody has measured:
 * `OLLAMA_NUM_PARALLEL` is set nowhere in this repo, and every app-side
 * concurrency knob (`PROPOSITION_ANALYSIS_CONCURRENCY`,
 * `BILL_ENRICHMENT_CONCURRENCY`, and the rest) defaults to 1.
 *
 * The repo's own comments state the dependency — "CONCURRENCY>1 only helps when
 * Ollama has OLLAMA_NUM_PARALLEL set to at least this, otherwise app-level
 * parallelism just queues" — but nothing has checked which regime this machine
 * is in.
 *
 * ## Measure the server, do not read its config
 *
 * The effective parallelism is inferred from behaviour rather than from an
 * environment variable, because the environment variable is not the whole
 * story: Ollama picks a default when the variable is unset, the choice depends
 * on available memory and model size, and a value that was set at boot may not
 * describe the process now serving. Sending N requests at concurrency C and
 * watching how wall clock moves answers the question the config only implies.
 *
 * Reading the result:
 *
 *   - **Speedup ≈ C** — the server genuinely runs C requests at once, and
 *     app-side concurrency is worth raising.
 *   - **Speedup ≈ 1** — requests are serialised somewhere, and raising an
 *     app-side knob only deepens a queue. This is what a default of
 *     `OLLAMA_NUM_PARALLEL=1` looks like from the outside.
 *   - **Speedup between** — batching helps but shares a saturated GPU. The
 *     per-request latency column is what distinguishes "more work done" from
 *     "same work, spread thinner".
 *
 * Every request does comparable work: `maxTokens` is fixed so a model that
 * happens to write longer answers does not read as a slower one.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/eval-harness eval:throughput -- \
 *     --model qwen3.5:9b --no-think [--concurrency 1,2,4] [--requests 8]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertFreshBuilds } from "./build-freshness.js";
import {
  probeModel,
  describeProvenance,
  slugFor,
  assertThinkDecided,
  type ModelProvenance,
} from "./provenance.js";
import { createLlmBackend } from "./backends/llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface Lane {
  concurrency: number;
  requests: number;
  wallClockMs: number;
  tokensOut: number;
  /** Aggregate output tokens per second across the whole lane. */
  aggregateTokensPerSecond: number;
  /** Median single-request latency. */
  medianLatencyMs: number;
  maxLatencyMs: number;
  /** Wall clock at concurrency 1 divided by this lane's. 1.0 is no gain. */
  speedup: number;
  failures: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** Run `requests` generations, at most `concurrency` in flight at once. */
async function runLane(
  generate: (prompt: string) => Promise<{ tokensOut?: number; ms: number }>,
  prompts: string[],
  concurrency: number,
): Promise<Omit<Lane, "speedup">> {
  const latencies: number[] = [];
  let tokensOut = 0;
  let failures = 0;
  let next = 0;

  const started = Date.now();
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = next++;
      if (i >= prompts.length) return;
      try {
        const r = await generate(prompts[i]);
        latencies.push(r.ms);
        tokensOut += r.tokensOut ?? 0;
      } catch {
        // A failed request must not silently shrink the denominator and make
        // the lane look faster than it was.
        failures++;
      }
    }
  });
  await Promise.all(workers);
  const wallClockMs = Date.now() - started;

  return {
    concurrency,
    requests: prompts.length,
    wallClockMs,
    tokensOut,
    aggregateTokensPerSecond:
      wallClockMs > 0
        ? Number(((tokensOut / wallClockMs) * 1000).toFixed(2))
        : 0,
    medianLatencyMs: median(latencies),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    failures,
  };
}

function describe(lanes: Lane[]): string[] {
  const lines = [
    "",
    "conc  requests  wall(s)  agg tok/s  median lat(s)  max lat(s)  speedup  fail",
  ];
  for (const l of lanes) {
    lines.push(
      [
        String(l.concurrency).padStart(4),
        String(l.requests).padStart(10),
        (l.wallClockMs / 1000).toFixed(1).padStart(9),
        l.aggregateTokensPerSecond.toFixed(1).padStart(11),
        (l.medianLatencyMs / 1000).toFixed(1).padStart(15),
        (l.maxLatencyMs / 1000).toFixed(1).padStart(12),
        `${l.speedup.toFixed(2)}x`.padStart(9),
        String(l.failures).padStart(6),
      ].join(""),
    );
  }

  const top = lanes[lanes.length - 1];
  const base = lanes[0];
  lines.push("", verdict(base, top));
  return lines;
}

function verdict(base: Lane, top: Lane): string {
  if (top.concurrency === base.concurrency) {
    return "Only one concurrency level measured — nothing to compare.";
  }

  const latencyRatio =
    base.medianLatencyMs > 0 ? top.medianLatencyMs / base.medianLatencyMs : 1;

  if (top.speedup < 1.15) {
    return (
      `Concurrency buys nothing: ${top.concurrency} in flight finishes in ` +
      `${top.speedup.toFixed(2)}x the time of one at a time, and median latency ` +
      `rose ${latencyRatio.toFixed(1)}x. Requests are being serialised, so ` +
      `raising an app-side CONCURRENCY knob would only deepen a queue.\n\n` +
      `Setting OLLAMA_NUM_PARALLEL is NOT necessarily the fix, and this is the ` +
      `trap: measured 2026-09-15, qwen35 produced this same result with the ` +
      `variable set to 4, because Ollama logs "model architecture does not ` +
      `currently support parallel requests" at WARN and loads with Parallel:1 ` +
      `anyway. olmo3 DID load with Parallel:4 and four KV slots — and still ` +
      `showed no aggregate gain, because the GPU is saturated by one request.\n` +
      `Check the server log for that warning before concluding anything: the ` +
      `API reports no capability flag, so the log is the only place the ` +
      `downgrade appears.`
    );
  }

  if (top.speedup >= top.concurrency * 0.75) {
    return (
      `Concurrency scales near-linearly: ${top.speedup.toFixed(2)}x at ` +
      `${top.concurrency} in flight. App-side concurrency is worth raising, and ` +
      `M6's doubling is affordable on this hardware.`
    );
  }

  return (
    `Concurrency helps but sub-linearly: ${top.speedup.toFixed(2)}x at ` +
    `${top.concurrency} in flight, with median latency ${latencyRatio.toFixed(1)}x ` +
    `higher. The GPU is shared rather than idle — more total work completes, but ` +
    `each request waits longer. Size M6 on the aggregate figure, and do not ` +
    `promise per-request latency that this does not support.`
  );
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
  const levels = (arg("concurrency") ?? "1,2,4")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  const requests = Number.parseInt(arg("requests") ?? "8", 10);
  // Fixed so every request does comparable work. A model that writes longer
  // answers must not read as a slower one.
  const maxTokens = Number.parseInt(arg("max-tokens") ?? "400", 10);

  const provenance: ModelProvenance = await probeModel(model);
  assertThinkDecided(provenance, thinkWasExplicit);

  // Representative input: real measure text at the size production sends.
  const source = JSON.parse(
    readFileSync(join(ROOT, "fixtures/fulltext-propositions.json"), "utf8"),
  ) as {
    items: Array<{ externalId: string; title: string; fullText: string }>;
  };

  const prompts = Array.from({ length: requests }, (_, i) => {
    const item = source.items[i % source.items.length];
    return [
      "Summarise this ballot measure in two sentences of plain language.",
      "",
      `Title: ${item.title}`,
      "",
      item.fullText.slice(0, 4000),
    ].join("\n");
  });

  const backend = createLlmBackend({ model, think, maxTokens });

  console.error(
    `warming ${model} (the first call pays model load, which would land ` +
      `entirely on the first lane and read as poor concurrency)...`,
  );
  await backend.generate(prompts[0]);

  const lanes: Lane[] = [];
  let baselineWall = 0;
  for (const concurrency of levels) {
    process.stderr.write(`concurrency ${concurrency} ... `);
    const lane = await runLane(
      (p) => backend.generate(p),
      prompts,
      concurrency,
    );
    if (lanes.length === 0) baselineWall = lane.wallClockMs;
    const speedup =
      lane.wallClockMs > 0
        ? Number((baselineWall / lane.wallClockMs).toFixed(3))
        : 0;
    lanes.push({ ...lane, speedup });
    process.stderr.write(
      `${(lane.wallClockMs / 1000).toFixed(1)}s (${speedup.toFixed(2)}x)\n`,
    );
  }

  const header = [
    `${describeProvenance(provenance)} digest=${provenance.digest}`,
    `requests=${requests} maxTokens=${maxTokens} think=${think}`,
    // Deliberately NOT a claim about what the server is configured for. The
    // repo does not set OLLAMA_NUM_PARALLEL, but the server may; and Ollama
    // may accept the setting and then ignore it (see the verdict below). Only
    // the measured behaviour is reported here.
    `effective parallelism is inferred from behaviour below, not read from config`,
  ];
  console.log(`\n${[...header, ...describe(lanes)].join("\n")}`);

  const out = {
    ranAt: new Date().toISOString(),
    model,
    provenance,
    think,
    maxTokens,
    requests,
    lanes,
  };
  mkdirSync(join(ROOT, "results"), { recursive: true });
  const path = join(ROOT, "results", `throughput-${slugFor(provenance)}.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwritten: ${path.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
