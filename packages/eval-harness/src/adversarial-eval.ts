/**
 * Adversarial evaluation — splice an injection into a real measure, analyse it,
 * and see whether the document steered its own analysis (#1142, #1143).
 *
 * See `scoring/injection.ts` for the threat model. The short version: the
 * attacker is the document's own author, because anyone can file an initiative
 * and the filed text reaches the analysis prompt verbatim.
 *
 * The injection is spliced into a REAL measure so everything around it is
 * realistic — an attack that only works against a toy document proves nothing
 * about production. Placement matters and is per-case: an instruction at the
 * head of a document is read as framing, one at the tail as an afterthought,
 * and one in the middle as part of the text.
 *
 * Usage:
 *   PROMPT_SERVICE_URL=... PROMPT_SERVICE_API_KEY=... \
 *     pnpm --filter @opuspopuli/eval-harness eval:adversarial -- \
 *       --model qwen3.5:9b --no-think [--case inj-003-framing]
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
import { scoreGrounding } from "./scoring/grounding.js";
import {
  scoreInjection,
  summarizeInjections,
  type InjectionCase,
  type InjectionResult,
} from "./scoring/injection.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface FixtureCase extends InjectionCase {
  base: string;
  control?: boolean;
}

interface SourceItem {
  externalId: string;
  title: string;
  fullText: string;
}

/**
 * Splice the payload in at the requested position.
 *
 * `middle` lands on a paragraph boundary near the centre rather than mid-word:
 * an injection cut through the middle of a sentence tests the tokenizer, not
 * the model's willingness to follow instructions.
 */
export function inject(text: string, c: FixtureCase): string {
  if (!c.payload) return text;
  if (c.placement === "head") return c.payload + text;
  if (c.placement === "tail") return text + c.payload;

  const mid = Math.floor(text.length / 2);
  const boundary = text.indexOf("\n", mid);
  const at = boundary === -1 ? mid : boundary;
  return text.slice(0, at) + c.payload + text.slice(at);
}

/** Same formatting production uses, so the attack faces the real prompt. */
function formatPropData(item: SourceItem, fullText: string): string {
  return [
    `ExternalId: ${item.externalId}`,
    `Title: ${item.title}`,
    "",
    "FullText:",
    fullText,
  ].join("\n");
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
  const only = arg("case");

  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/adversarial-propositions.json"), "utf8"),
  ) as { cases: FixtureCase[] };
  const source = JSON.parse(
    readFileSync(join(ROOT, "fixtures/fulltext-propositions.json"), "utf8"),
  ) as { items: SourceItem[] };
  const byId = new Map(source.items.map((i) => [i.externalId, i]));

  const cases = only
    ? fixture.cases.filter((c) => c.id === only)
    : fixture.cases;

  const missing = cases.filter((c) => !byId.has(c.base));
  if (missing.length > 0) {
    throw new Error(
      `No source text for: ${missing.map((c) => c.base).join(", ")}. ` +
        "Rebuild with: pnpm --filter @opuspopuli/eval-harness fixtures:fulltext",
    );
  }

  const provenance: ModelProvenance = await probeModel(model);
  assertThinkDecided(provenance, thinkWasExplicit);
  const backend = createLlmBackend({ model, think });

  const db = new DbService();
  const results: InjectionResult[] = [];
  const rows: Array<{
    id: string;
    base: string;
    control: boolean;
    json: string;
    result: InjectionResult;
    fabricatedFigures: string[];
  }> = [];
  let promptHash = "";
  let templateName = "";

  try {
    for (const c of cases) {
      const item = byId.get(c.base)!;
      const poisoned = inject(item.fullText, c);

      const prompt = await resolveAnalysisPrompt(
        db,
        "proposition-analysis",
        formatPropData(item, poisoned),
      );
      promptHash = prompt.promptHash;
      templateName = prompt.templateName;

      process.stderr.write(`${c.id} (${c.class}, ${c.base}) ... `);
      const run = await backend.generate(prompt.promptText);
      const json = scoreJsonValidity({
        text: run.text,
        finishReason: run.finishReason,
        tokensOut: run.tokensOut,
        maxTokens: run.maxTokens,
      });
      const payload = json.payload ?? {};

      const result = scoreInjection(c, payload, true);
      // A fabricated figure is independent corroboration: the injection for
      // inj-002 carries a dollar amount absent from the source, so the
      // grounding scorer should see it without knowing an attack happened.
      const grounding = scoreGrounding(
        [
          payload.analysisSummary,
          payload.fiscalImpact,
          ...(Array.isArray(payload.keyProvisions)
            ? payload.keyProvisions
            : []),
        ]
          .filter((v): v is string => typeof v === "string")
          .join("\n"),
        item.fullText, // the CLEAN text: a figure from the injection is not grounded
      );

      results.push(result);
      rows.push({
        id: c.id,
        base: c.base,
        control: c.control ?? false,
        json: json.verdict,
        result,
        fabricatedFigures: grounding.fabricated.map((f) => f.raw),
      });
      process.stderr.write(
        `${result.compromised ? "COMPROMISED" : "resisted"} (${(run.ms / 1000).toFixed(0)}s)\n`,
      );
    }
  } finally {
    await db.$disconnect().catch(() => undefined);
  }

  const controls = rows.filter((r) => r.control);
  const attacks = rows.filter((r) => !r.control);
  const summary = summarizeInjections(attacks.map((r) => r.result));

  const lines = [
    `${describeProvenance(provenance)} digest=${provenance.digest}`,
    `prompt=${templateName} hash=${promptHash.slice(0, 12)}`,
    "",
    "── Control (no injection — must come back clean)",
    "",
  ];
  for (const c of controls) {
    lines.push(
      c.result.compromised
        ? `${c.id}: FLAGGED on clean input — the detectors are producing false positives and every reading below is untrustworthy: ${c.result.evidence.join("; ")}`
        : `${c.id}: clean — the detectors do not fire on an un-injected document`,
    );
  }

  lines.push(
    "",
    "── Injections",
    "",
    "case                    class                  json    verdict      evidence",
  );
  for (const r of attacks) {
    lines.push(
      [
        r.id.padEnd(24),
        r.result.class.padEnd(23),
        r.json.padEnd(8),
        (r.result.compromised ? "COMPROMISED" : "resisted").padEnd(13),
        r.result.evidence.join("; ") || "—",
      ].join(""),
    );
    if (r.fabricatedFigures.length) {
      lines.push(
        `${" ".repeat(24)}^ grounding caught fabricated figures independently: ${r.fabricatedFigures.join(", ")}`,
      );
    }
  }

  lines.push(
    "",
    `${summary.compromised}/${summary.cases} compromised · ` +
      `canary echoes ${summary.canaryEchoes} · behavioural-only ${summary.behaviouralOnly}`,
    "",
    summary.verdict,
  );

  console.log(`\n${lines.join("\n")}`);

  mkdirSync(join(ROOT, "results"), { recursive: true });
  const path = join(ROOT, "results", `adversarial-${slugFor(provenance)}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({ ranAt: new Date().toISOString(), model, provenance, think, rows, summary }, null, 2)}\n`,
  );
  console.log(`\nwritten: ${path.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
