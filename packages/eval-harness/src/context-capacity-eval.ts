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
 * ## Usage
 *
 *   pnpm --filter @opuspopuli/eval-harness eval:context -- \
 *     --models nemotron-3.5-lightning:30b-a3b-mlx,nemotron-3.5-lightning:30b-a3b \
 *     [--num-ctx 131072] [--out results/context-capacity.json]
 *
 * Reads its documents from the live database rather than fixtures, because the
 * documents that break are the real ones — a 451 KB bill is not a shape anyone
 * would think to write a fixture for.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DbService } from "@opuspopuli/relationaldb-provider";

/** Chars per token for the ESTIMATE only. Coarse on purpose — see below. */
const CHARS_PER_TOKEN = 4;

/**
 * Coverage below which the prompt was certainly cut.
 *
 * Measured across 15 bill runs: genuine full reads landed between 84% and 149%
 * of a chars/4 estimate (tokenizers differ by 20-50% across families), while
 * truncated runs landed at 15%. Nothing observed sits between, so 0.5
 * separates them with wide margin in both directions.
 */
const TRUNCATION_THRESHOLD = 0.5;

interface CaseResult {
  model: string;
  document: string;
  promptChars: number;
  promptTokensEstimated: number;
  promptTokensRead?: number;
  coverage: number;
  truncated: boolean;
  loadSeconds: number;
  promptEvalSeconds: number;
  generateSeconds: number;
  wallSeconds: number;
  parsedJson: boolean;
  finishReason?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function generate(
  url: string,
  model: string,
  prompt: string,
  numCtx?: number,
): Promise<CaseResult["promptTokensRead"] extends never ? never : Record<string, unknown>> {
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
  const data = (await response.json()) as Record<string, number | string>;
  return { ...data, wallMs: Date.now() - started };
}

/**
 * Documents chosen to span the two shapes that stress different things:
 * generation-heavy (small prompt, large output) and read-heavy (large prompt,
 * small output). The largest is included precisely because it breaks things.
 */
async function loadDocuments(db: DbService, limit: number) {
  const bills = await db.bill.findMany({
    where: { fullTextUrl: { not: null } },
    select: { billNumber: true, title: true },
    take: limit,
  });
  const propositions = await db.proposition.findMany({
    where: { fullText: { not: null } },
    select: { externalId: true, fullText: true },
    orderBy: { id: "asc" },
    take: limit,
  });
  return { bills, propositions };
}

async function main(): Promise<void> {
  const url = process.env.LLM_URL ?? "http://localhost:11434";
  const models = (arg("models") ?? "").split(",").filter(Boolean);
  if (models.length === 0) {
    console.error("Pass --models <a,b,...>");
    process.exit(2);
  }
  const numCtx = arg("num-ctx") ? Number.parseInt(arg("num-ctx")!, 10) : undefined;
  const out = arg("out") ?? "results/context-capacity.json";

  const db = new DbService();
  const { propositions } = await loadDocuments(db, 5);

  const results: CaseResult[] = [];
  for (const model of models) {
    for (const doc of propositions) {
      const prompt = doc.fullText ?? "";
      if (!prompt) continue;
      const estimated = Math.ceil(prompt.length / CHARS_PER_TOKEN);
      const raw = (await generate(url, model, prompt, numCtx)) as Record<string, number | string>;
      const read = raw.prompt_eval_count as number | undefined;
      const coverage = read ? read / estimated : 0;
      const text = (raw.response as string) ?? "";
      let parsedJson = false;
      try {
        JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        parsedJson = true;
      } catch {
        parsedJson = false;
      }
      const result: CaseResult = {
        model,
        document: doc.externalId,
        promptChars: prompt.length,
        promptTokensEstimated: estimated,
        promptTokensRead: read,
        coverage: Number(coverage.toFixed(2)),
        truncated: coverage < TRUNCATION_THRESHOLD,
        loadSeconds: Number((((raw.load_duration as number) ?? 0) / 1e9).toFixed(1)),
        promptEvalSeconds: Number(
          (((raw.prompt_eval_duration as number) ?? 0) / 1e9).toFixed(1),
        ),
        generateSeconds: Number((((raw.eval_duration as number) ?? 0) / 1e9).toFixed(1)),
        wallSeconds: Number((((raw.wallMs as number) ?? 0) / 1000).toFixed(0)),
        parsedJson,
        finishReason: raw.done_reason as string | undefined,
      };
      results.push(result);
      console.log(
        `${model} ${doc.externalId}: read ${read}/${estimated} ` +
          `(${Math.round(coverage * 100)}%)${result.truncated ? "  TRUNCATED" : ""}`,
      );
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ numCtx, results }, null, 2)}\n`);
  console.log(`\nWrote ${results.length} result(s) to ${out}`);

  const truncated = results.filter((r) => r.truncated);
  if (truncated.length > 0) {
    console.log(`\n${truncated.length} run(s) were TRUNCATED:`);
    for (const r of truncated) {
      console.log(
        `  ${r.model} on ${r.document}: read ${r.promptTokensRead} of ` +
          `~${r.promptTokensEstimated} estimated tokens`,
      );
    }
  }
  await db.$disconnect();
}

void main();
