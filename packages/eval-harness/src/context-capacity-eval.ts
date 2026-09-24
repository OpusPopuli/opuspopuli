/**
 * Context-capacity evaluation — does the model actually READ what we send it?
 *
 * Every other leg of this harness scores the quality of an answer. This one
 * scores whether the question arrived intact, because on 2026-09-23 that turned
 * out to be the failure nobody was looking for.
 *
 * ## The failure this exists to catch
 *
 * Ollama enforces `num_ctx` by silently truncating the prompt. No error, no
 * flag — a fluent, well-formed answer about the fragment it read. Measured
 * against a real 451 KB California bill (AB 1830, ~112,878 estimated tokens),
 * three different model builds reported:
 *
 *     prompt_eval_count = 16386
 *
 * which is a 16,384-token window plus two. All three returned VALID JSON
 * summarising roughly the first 15% of the bill as though it were the whole
 * thing. One did it in 5 seconds.
 *
 * Valid output describing the wrong thing is worse than a failure: nothing
 * downstream can distinguish it from a complete answer, and storing it is
 * publishing it. #1322 added detection in the provider; this measures which
 * models and settings avoid the condition in the first place.
 *
 * ## What it measures, and what it does NOT
 *
 * It sends **proposition full text**, largest first, and reports how much of it
 * the model read. It does NOT send bills: `Bill` has no full-text column — only
 * `fullTextUrl` — so bill bodies are not in the database to be read (#1323
 * review). The AB 1830 figures above were measured by hand before this harness
 * existed and are quoted here as the finding, not as this tool's output. Adding
 * bills means resolving `fullTextUrl` first, which is filed separately.
 *
 * Outcome per run is one of three states, never two:
 *
 *   - `read` — coverage at or above {@link MIN_PROMPT_COVERAGE}
 *   - `truncated` — the model reported reading materially less than we sent
 *   - `unknown` — the model reported no input count at all
 *
 * `unknown` exists because an HTTP failure or a model with no telemetry must
 * not be recorded as the finding this file is named after. The provider draws
 * the same line (`detectPromptTruncation` returns `{}` when the count is
 * absent), and a tool that blurred it would manufacture its own headline.
 *
 * ## What it reports, and why each column exists
 *
 *   - `promptTokensRead` vs `promptTokensEstimated` — coverage. The headline.
 *   - `loadSeconds` — cold start, paid on every service restart. Hidden inside
 *     wall-clock otherwise: a 165s call turned out to be 93s of load.
 *   - `promptEvalSeconds` — reading. Dominates bill-shaped work (28k in, 300
 *     out).
 *   - `generateSeconds` — writing. Dominates proposition-shaped work (5k in,
 *     2k out). Which of these two dominates is what should decide a lane,
 *     rather than model size.
 *
 * There is no "valid JSON" column. The prompt here is the document itself with
 * no instructions — prompt text lives in `prompt-service` and is never inlined
 * in this repo — so nothing asks the model for JSON and scoring it would be
 * scoring noise.
 *
 * ## Usage
 *
 *   pnpm --filter @opuspopuli/eval-harness eval:context -- \
 *     --models nemotron-3.5-lightning:30b-a3b \
 *     [--num-ctx 131072] [--limit 5] [--out results/context-capacity.json]
 *
 * Reads its documents from the live database rather than fixtures, because the
 * documents that break are the real ones — sized in hundreds of kilobytes, a
 * shape nobody would think to write a fixture for.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { setGlobalHttpPool } from "@opuspopuli/common";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  MIN_PROMPT_COVERAGE,
  resolveContextTokens,
  contextTokensWarning,
} from "@opuspopuli/llm-provider";
import { DbService } from "@opuspopuli/relationaldb-provider";

import { assertFreshBuilds } from "./build-freshness.js";
import { probeModel, type ModelProvenance } from "./provenance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Raise the transport ceiling before the first request, exactly as
 * `backends/llm.ts` and the three production services do.
 *
 * undici's default `headersTimeout` is 300s and applies before a single token
 * arrives, so without this the runs this file exists to measure are the ones
 * that cannot complete: reading a 451 KB bill at a 131072 window took **314s**,
 * and the analysis sweeps behind the model decision took 321s and 783s. Each
 * would have died as a bare `fetch failed` — indistinguishable, from the
 * outside, from the model being broken.
 */
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

/** Hard ceiling per request, so a stalled server cannot hang the sweep. */
const REQUEST_TIMEOUT_MS = 1_320_000;

type Outcome = "read" | "truncated" | "unknown";

interface CaseResult {
  model: string;
  document: string;
  promptChars: number;
  promptTokensEstimated: number;
  promptTokensRead?: number;
  /** Undefined when `outcome` is `unknown` — there is nothing to divide. */
  coverage?: number;
  outcome: Outcome;
  loadSeconds: number;
  promptEvalSeconds: number;
  generateSeconds: number;
  wallSeconds: number;
  responseChars: number;
  finishReason?: string;
}

interface OllamaGenerateResponse {
  response?: string;
  prompt_eval_count?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  done_reason?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Nanoseconds to seconds, one decimal. Ollama reports every duration in ns. */
function seconds(ns: number | undefined, decimals = 1): number {
  return Number(((ns ?? 0) / 1e9).toFixed(decimals));
}

async function generate(
  url: string,
  model: string,
  prompt: string,
  numCtx?: number,
): Promise<OllamaGenerateResponse & { wallMs: number }> {
  const options: Record<string, unknown> = {
    num_predict: 2000,
    temperature: 0.1,
    seed: 7,
  };
  if (numCtx) options.num_ctx = numCtx;

  const started = Date.now();
  const response = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      // Matches the provider default. A reasoning model left to its own
      // devices can spend the entire budget in `thinking` and return an empty
      // `response`, which reads as a model incompatibility and is one flag.
      think: false,
      options,
    }),
  });

  // Checked, because an unchecked failure here is the worst possible outcome
  // for this particular tool: `{"error": "model not found"}` has no
  // `prompt_eval_count`, and a typo'd tag would otherwise be published as a
  // 0%-coverage TRUNCATED row — the finding, manufactured out of nothing.
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${model}: Ollama returned ${response.status} ${response.statusText}` +
        `${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  return { ...data, wallMs: Date.now() - started };
}

/**
 * The largest documents, because size is the whole variable.
 *
 * `orderBy: { id }` would have taken an arbitrary five — `id` is a `uuid()`
 * primary key, so it sorts by nothing meaningful, and the five it returned were
 * comfortably inside a 16K window. A sweep that cannot reach the failure cannot
 * measure it, which is why this orders by length in SQL.
 */
async function loadDocuments(
  db: DbService,
  limit: number,
): Promise<{ externalId: string; fullText: string }[]> {
  return db.$queryRaw<{ externalId: string; fullText: string }[]>`
    SELECT external_id AS "externalId", full_text AS "fullText"
    FROM propositions
    WHERE full_text IS NOT NULL AND length(full_text) > 0
    ORDER BY length(full_text) DESC
    LIMIT ${limit}
  `;
}

/**
 * `full_text` is sent unredacted, deliberately.
 *
 * It carries the proponent's transmittal letter and with it a named
 * individual's address, email and phone. That is public record — the Attorney
 * General publishes proponent contact details so the public can reach them,
 * and CCPA excludes information lawfully made available from government
 * records (Cal. Civ. Code § 1798.140(v)(2)). Connecting named people to the
 * documents they file is the product; stripping it would be removing the
 * signal, not protecting anyone.
 *
 * It also has to be unredacted to measure anything. Production sends this text
 * as-is, and the question this file asks is whether the model read WHAT WE
 * SENT. A redacted prompt is one production never issues.
 *
 * This is NOT the rule for `build-fulltext-fixture.ts`, which redacts the same
 * column. Its reason is different and still holds: a fixture lands in git
 * history, and republishing a public record as committed test data is a
 * separate act from the state publishing it. Nothing here is committed —
 * `CaseResult` records counts and timings, never text.
 *
 * Nor does it extend to petition scans (`documents`), whose text is signers:
 * ordinary members of the public, not public figures who filed anything.
 */
async function runCase(
  url: string,
  model: string,
  doc: { externalId: string; fullText: string },
  numCtx: number | undefined,
): Promise<CaseResult> {
  const prompt = doc.fullText;
  const estimated = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const raw = await generate(url, model, prompt, numCtx);

  const read = raw.prompt_eval_count;
  const coverage = read === undefined ? undefined : read / estimated;
  const outcome: Outcome =
    coverage === undefined
      ? "unknown"
      : coverage < MIN_PROMPT_COVERAGE
        ? "truncated"
        : "read";

  return {
    model,
    document: doc.externalId,
    promptChars: prompt.length,
    promptTokensEstimated: estimated,
    promptTokensRead: read,
    // Rounded for reading, but `outcome` is decided on the unrounded value, so
    // a row can never read as 0.5-and-truncated.
    coverage: coverage === undefined ? undefined : Number(coverage.toFixed(3)),
    outcome,
    loadSeconds: seconds(raw.load_duration),
    promptEvalSeconds: seconds(raw.prompt_eval_duration),
    generateSeconds: seconds(raw.eval_duration),
    wallSeconds: seconds(raw.wallMs * 1e6, 0),
    responseChars: (raw.response ?? "").length,
    finishReason: raw.done_reason,
  };
}

function describe(r: CaseResult): string {
  const head = `${r.model} ${r.document}:`;
  if (r.outcome === "unknown") {
    return `${head} no prompt_eval_count reported — coverage UNKNOWN`;
  }
  const pct = Math.round((r.coverage ?? 0) * 100);
  const flag = r.outcome === "truncated" ? "  TRUNCATED" : "";
  return `${head} read ${r.promptTokensRead}/${r.promptTokensEstimated} (${pct}%)${flag}`;
}

interface Invocation {
  url: string;
  models: string[];
  numCtx?: number;
  limit: number;
  out: string;
}

/**
 * Validate the invocation, or refuse it.
 *
 * Every exit here is a case that used to run and produce a *plausible* results
 * file: a missing `--models` list 404ing once per document and recording five
 * TRUNCATED rows, `--num-ctx 131o72` measuring the default window while
 * reporting `"numCtx": null`. For a tool whose only output is a judgement about
 * silent misconfiguration, refusing to start is the only safe failure.
 */
function parseInvocation(): Invocation {
  const models = (arg("models") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0 || models.some((m) => m.startsWith("--"))) {
    console.error(
      "Pass --models <a,b,...>  (a value starting with -- means the list was " +
        "omitted, which would otherwise 404 once per document)",
    );
    process.exit(2);
  }

  // Held to the same rule as the deployed setting, by the same function.
  const { contextTokens: numCtx, warning } = resolveContextTokens(
    arg("num-ctx"),
  );
  if (warning) {
    console.error(contextTokensWarning(warning));
    process.exit(2);
  }

  const limit = Number.parseInt(arg("limit") ?? "5", 10);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    console.error(
      `--limit must be a positive whole number, got "${arg("limit")}"`,
    );
    process.exit(2);
  }

  return {
    // `OLLAMA_URL` is the harness convention (`provenance.ts`,
    // `backends/llm.ts`) and must be the same host the model is probed on, or
    // provenance would describe a different machine than the one measured.
    // `LLM_URL` is still honoured so an existing shell keeps working.
    url:
      process.env.OLLAMA_URL ?? process.env.LLM_URL ?? "http://localhost:11434",
    models,
    numCtx,
    limit,
    out: arg("out") ?? join(ROOT, "results", "context-capacity.json"),
  };
}

async function main(): Promise<void> {
  // Without this the sweep can measure a stale `dist` and attribute the result
  // to the source in the working tree. Every other eval in this package asserts
  // it first, for the same reason.
  assertFreshBuilds();

  const { url, models, numCtx, limit, out } = parseInvocation();
  const results: CaseResult[] = [];
  const provenance: Record<string, ModelProvenance> = {};
  const db = new DbService();

  try {
    const documents = await loadDocuments(db, limit);
    if (documents.length === 0) {
      throw new Error(
        "No propositions with full_text in this database. Sync a region first.",
      );
    }
    console.log(
      `${documents.length} document(s), largest ${documents[0].fullText.length} chars\n`,
    );

    for (const model of models) {
      // Recorded per model, because "which model" is a tag and a tag is not
      // provenance — `provenance.ts` exists because a model-selection decision
      // rested on numbers nobody could reproduce.
      provenance[model] = await probeModel(model, url);
      for (const doc of documents) {
        const result = await runCase(url, model, doc, numCtx);
        results.push(result);
        console.log(describe(result));
      }
    }
  } finally {
    // Written even on failure: a sweep that dies on its fourth model must not
    // discard the three it measured, which each cost minutes.
    if (results.length > 0) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        `${JSON.stringify(
          {
            ranAt: new Date().toISOString(),
            numCtx: numCtx ?? null,
            provenance,
            results,
          },
          null,
          2,
        )}\n`,
      );
      console.log(
        `\nWrote ${results.length} result(s) to ${out.replace(ROOT, ".")}`,
      );
    }
    await db.$disconnect();
  }

  report(results);
}

/** Non-zero exit on a bad outcome, so this can gate something. */
function report(results: CaseResult[]): void {
  const bad = results.filter((r) => r.outcome !== "read");
  if (bad.length === 0) return;

  console.log(`\n${bad.length} run(s) did not read the document:`);
  for (const r of bad) {
    console.log(
      r.outcome === "unknown"
        ? `  ${r.model} on ${r.document}: no input count reported`
        : `  ${r.model} on ${r.document}: read ${r.promptTokensRead} of ` +
            `~${r.promptTokensEstimated} estimated tokens`,
    );
  }
  process.exitCode = 1;
}

// Entry guard, as in every other eval in this package: a bare `void main()`
// turns any failure into an unhandled rejection with no exit code, and opens a
// database connection on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
