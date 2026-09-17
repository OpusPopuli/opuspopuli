/**
 * Generation evaluation harness — the measure of what the analysis pipeline
 * actually produces (roadmap R3 / M4, #1142).
 *
 * The retrieval and OCR legs of this harness already exist. This is the leg
 * #1142's headline table came from — and that table is not reproducible,
 * because the run that produced it used a script nobody committed. A harness
 * whose stated purpose is that confident claims must survive measurement
 * cannot leave its own results unreproducible, so this is the first thing the
 * remaining R3 work rebuilds.
 *
 * What it measures, and what it deliberately does not:
 *
 *   - **JSON validity** through production's own salvage path, with
 *     `empty-response` kept distinct from `no-json`.
 *   - **Numeric grounding** — every figure emitted must appear in the source.
 *   - **Abstention correctness** — an empty `fiscalImpact` on AG-filed text is
 *     the RIGHT answer.
 *   - **Claim-span anchoring**, scored on raw offsets and supporting #1212's
 *     quote-then-locate contract as well.
 *   - **NOT field completeness.** A 3.4B model once topped the scoreboard by
 *     fabricating the fiscal impact. See #1142.
 *
 * Usage:
 *   PROMPT_SERVICE_URL=http://localhost:3210 PROMPT_SERVICE_API_KEY=... \
 *     pnpm --filter @opuspopuli/eval-harness eval:generation -- \
 *       --model qwen3.5:9b [--think] [--limit 3] \
 *       [--contract quote-then-locate] [--document-type proposition-analysis-quoted]
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
import { createLlmBackend, type GenerationRun } from "./backends/llm.js";
import { scoreJsonValidity } from "./scoring/json-validity.js";
import { scoreGrounding } from "./scoring/grounding.js";
import {
  scoreAbstention,
  type FieldExpectation,
} from "./scoring/abstention.js";
import {
  scoreAnchoring,
  type AnchorContract,
  type EmittedClaim,
} from "./scoring/anchoring.js";
import { scoreCalibration, type ScoredClaim } from "./scoring/calibration.js";
import { scoreSourceHierarchy } from "./scoring/source-hierarchy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Narrow the model's raw `analysisClaims` to the shape the scorers read.
 *
 * Deliberately explicit rather than `as EmittedClaim[]`. A cast cannot catch
 * the producer and the scorer disagreeing about a field name, and that is
 * exactly how quote-then-locate shipped: the scorer read `claim.quote` while
 * the template emits `sourceQuote`, so every claim scored `missing-anchor`
 * and the S2 gate could only report 0% (#1212). Naming the fields here makes
 * a future rename a compile error instead of a silent zero.
 */
function toEmittedClaims(raw: unknown): EmittedClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const c = (entry ?? {}) as Record<string, unknown>;
    return {
      claim: typeof c.claim === "string" ? c.claim : "",
      field: typeof c.field === "string" ? c.field : "",
      sourceStart:
        typeof c.sourceStart === "number" ? c.sourceStart : undefined,
      sourceEnd: typeof c.sourceEnd === "number" ? c.sourceEnd : undefined,
      sourceQuote:
        typeof c.sourceQuote === "string" ? c.sourceQuote : undefined,
      confidence:
        typeof c.confidence === "string" || typeof c.confidence === "number"
          ? c.confidence
          : undefined,
    };
  });
}

/** The template production runs. Overridden with --document-type to measure a variant. */
const DEFAULT_DOCUMENT_TYPE = "proposition-analysis";

interface SourceItem {
  externalId: string;
  title: string;
  fullText: string;
  chars: number;
}

interface GoldItem {
  externalId: string;
  containsDollarFigure: boolean;
  fieldExpectations: FieldExpectation[];
}

export interface MeasureResult {
  externalId: string;
  chars: number;
  json: string;
  jsonValid: boolean;
  grounding: { rate: number; figures: number; fabricated: string[] };
  abstention: {
    rate: number;
    fabricated: number;
    missed: number;
    abstained: number;
  };
  anchoring: {
    contract: AnchorContract;
    rate: number;
    anchored: number;
    total: number;
    byVerdict: Record<string, number>;
    looksPartitioned: boolean;
    /** True when no claim carried an anchor at all — see AnchoringScore. */
    looksUnmapped: boolean;
    medianSpanChars?: number;
  };
  ms: number;
  tokensOut?: number;
  tokensPerSecond?: number;
  /**
   * Per-claim confidence and outcome, retained so calibration can be scored
   * across measures — and re-scored later without spending model time again.
   */
  claims: ScoredClaim[];
  /**
   * The parsed analysis, retained for the same reason: omission scoring needs
   * an embedding pass the generation leg should not pay for, and a metric that
   * arrives later must not cost another full run.
   */
  payload: Record<string, unknown>;
  /** Which zone of the document each citation points into. */
  hierarchy: {
    scored: number;
    transmittal: number;
    findings: number;
    operative: number;
    misattributed: number;
  };
}

/**
 * Format the proposition exactly as `proposition-analysis.service.ts` does.
 * The prompt asks for claim offsets INTO this string, so any difference here
 * moves every offset and would make the anchoring score describe a document
 * production never sent.
 */
function formatPropData(item: SourceItem): string {
  return [
    `ExternalId: ${item.externalId}`,
    `Title: ${item.title}`,
    "",
    "FullText:",
    item.fullText,
  ].join("\n");
}

const median = (xs: number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export function scoreOne(
  item: SourceItem,
  gold: GoldItem,
  run: GenerationRun,
  contract: AnchorContract,
): MeasureResult {
  const json = scoreJsonValidity({
    text: run.text,
    finishReason: run.finishReason,
    tokensOut: run.tokensOut,
    maxTokens: run.maxTokens,
  });

  const payload = json.payload ?? {};

  // Grounding runs over the prose the model wrote, not the raw JSON: keys and
  // offsets are not claims about magnitude, and counting them would drown the
  // signal. `fullText` is the source of truth a figure must appear in.
  const prose = [
    payload.analysisSummary,
    payload.fiscalImpact,
    payload.yesOutcome,
    payload.noOutcome,
    ...(Array.isArray(payload.keyProvisions) ? payload.keyProvisions : []),
  ]
    .filter((v): v is string => typeof v === "string")
    .join("\n");

  const grounding = scoreGrounding(prose, item.fullText);
  const abstention = scoreAbstention(payload, gold.fieldExpectations);

  const claims = toEmittedClaims(payload.analysisClaims);
  const anchoring = scoreAnchoring(claims, item.fullText, contract);
  // Where a citation POINTS matters as much as whether it resolves: a claim
  // about what the measure does, sourced from the proponent's covering letter,
  // cites a campaign document as if it were statute.
  // Zone attribution runs on the span the citation RESOLVES to, not the one
  // the model asserted. Under quote-then-locate the model emits no offsets at
  // all — the locator derives them — so reading c.sourceStart scored zero
  // claims and reported every zone as 0, which reads as "no transmittal
  // citations" rather than "not measured". Under the offsets contract the
  // resolved span is the validated one, so this is the better input there too.
  const hierarchy = scoreSourceHierarchy(
    anchoring.results.map((r, i) => ({
      claim: r.claim,
      field: r.field,
      // Prefer the RESOLVED span, fall back to what the model asserted.
      // Under quote-then-locate the model emits no offsets at all — the
      // locator derives them — so the raw fields are always undefined and
      // zone attribution scored zero claims, reporting every zone as 0. That
      // reads as "no transmittal citations" rather than "not measured".
      // The fallback matters for the offsets contract: `resolved` is unset
      // for an out-of-range citation, and dropping those would silently move
      // the recorded baselines in the plan's §2 rather than just fixing a
      // dead measurement.
      sourceStart: r.resolved?.start ?? claims[i]?.sourceStart,
      sourceEnd: r.resolved?.end ?? claims[i]?.sourceEnd,
    })),
    item.fullText,
  );

  return {
    externalId: item.externalId,
    chars: item.chars,
    json: json.verdict,
    jsonValid: json.valid,
    grounding: {
      rate: grounding.rate,
      figures: grounding.figures.length,
      fabricated: grounding.fabricated.map((f) => f.raw),
    },
    abstention: {
      rate: abstention.rate,
      fabricated: abstention.fabricated,
      missed: abstention.missed,
      abstained: abstention.abstained,
    },
    anchoring: {
      contract: anchoring.contract,
      rate: anchoring.rate,
      anchored: anchoring.anchored,
      total: anchoring.total,
      byVerdict: anchoring.byVerdict,
      looksPartitioned: anchoring.looksPartitioned,
      looksUnmapped: anchoring.looksUnmapped,
      medianSpanChars: median(
        anchoring.results
          .map((r) => r.spanChars)
          .filter((n): n is number => typeof n === "number"),
      ),
    },
    ms: run.ms,
    tokensOut: run.tokensOut,
    tokensPerSecond: run.tokensPerSecond,
    claims: anchoring.results.map((r) => ({
      confidence: r.confidence,
      anchored: r.anchored,
    })),
    payload,
    hierarchy: {
      scored: hierarchy.scored,
      transmittal: hierarchy.byZone.transmittal,
      findings: hierarchy.byZone.findings,
      operative: hierarchy.byZone.operative,
      misattributed: hierarchy.misattributed,
    },
  };
}

function report(results: MeasureResult[], header: string[]): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines = [...header, ""];

  lines.push(
    "measure      chars   json           ground  abstain(fab/miss)  anchor        s",
  );
  for (const r of results) {
    lines.push(
      [
        r.externalId.padEnd(12),
        String(r.chars).padStart(6),
        `  ${r.json.padEnd(14)}`,
        pct(r.grounding.rate).padStart(6),
        `  ${pct(r.abstention.rate).padStart(4)} (${r.abstention.fabricated}/${r.abstention.missed})`.padEnd(
          19,
        ),
        `  ${r.anchoring.anchored}/${r.anchoring.total} ${pct(r.anchoring.rate).padStart(4)}`.padEnd(
          14,
        ),
        (r.ms / 1000).toFixed(0).padStart(4),
      ].join(""),
    );
  }

  const n = results.length;
  const valid = results.filter((r) => r.jsonValid).length;
  const anchoredTotal = results.reduce((s, r) => s + r.anchoring.anchored, 0);
  const claimsTotal = results.reduce((s, r) => s + r.anchoring.total, 0);
  const fabricatedFigures = results.flatMap((r) => r.grounding.fabricated);
  const abstainFab = results.reduce((s, r) => s + r.abstention.fabricated, 0);

  lines.push(
    "",
    `JSON valid        ${valid}/${n}`,
    `Claims anchored   ${anchoredTotal}/${claimsTotal}` +
      (claimsTotal ? ` (${pct(anchoredTotal / claimsTotal)})` : ""),
    ...(results.some((r) => r.anchoring.looksUnmapped)
      ? [
          "  !! EVERY claim scored missing-anchor. That is far likelier to be a",
          "     producer/scorer field mismatch than a model result — check that",
          "     the template emits the field the scorer reads. A 0% here is NOT",
          "     evidence the contract failed (#1212).",
        ]
      : []),
    `Fabricated figures ${fabricatedFigures.length}` +
      (fabricatedFigures.length ? ` — ${fabricatedFigures.join(", ")}` : ""),
    `Fabricated fields  ${abstainFab} (populated where the source cannot support it)`,
  );

  // Calibration across every claim in the run. Asked on behalf of #1209: if a
  // verification gate kept only high-confidence claims, would the survivors be
  // any better?
  const calibration = scoreCalibration(results.flatMap((r) => r.claims));
  if (calibration.n > 0 || calibration.withoutConfidence > 0) {
    lines.push("", "Confidence:");
    for (const g of calibration.groups) {
      lines.push(
        `  ${g.label.padEnd(8)} n=${String(g.count).padStart(3)} ` +
          `(${(g.share * 100).toFixed(0)}% of claims)  anchors ${(g.accuracy * 100).toFixed(1)}%`,
      );
    }
    lines.push(`  ${calibration.verdict}`);
  }

  const zones = results.reduce(
    (a, r) => ({
      scored: a.scored + r.hierarchy.scored,
      transmittal: a.transmittal + r.hierarchy.transmittal,
      findings: a.findings + r.hierarchy.findings,
      operative: a.operative + r.hierarchy.operative,
      misattributed: a.misattributed + r.hierarchy.misattributed,
    }),
    { scored: 0, transmittal: 0, findings: 0, operative: 0, misattributed: 0 },
  );
  if (zones.scored > 0) {
    lines.push(
      "",
      `Citation zones     ${zones.operative} operative · ${zones.findings} findings · ` +
        `${zones.transmittal} transmittal (of ${zones.scored} placed)`,
    );
    if (zones.transmittal > 0) {
      lines.push(
        `  ^ ${zones.transmittal} cite the proponent's COVERING LETTER — not law, not neutral`,
      );
    }
    if (zones.misattributed > 0) {
      lines.push(
        `  ^ ${zones.misattributed} source a claim about what the measure DOES from a non-operative zone`,
      );
    }
  }

  const partitioned = results.filter((r) => r.anchoring.looksPartitioned);
  if (partitioned.length) {
    lines.push(
      "",
      `Sequential partitioning detected on ${partitioned.length}/${n} measures ` +
        `(${partitioned.map((p) => p.externalId).join(", ")}) — the model is ` +
        "splitting the document, not locating text in it.",
    );
  }

  const spans = results
    .map((r) => r.anchoring.medianSpanChars)
    .filter((n): n is number => typeof n === "number");
  if (spans.length) {
    lines.push(`Median cited span  ${median(spans)} chars`);
  }

  return lines.join("\n");
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
  // Explicit means the flag was typed either way. A reasoning-capable model
  // run on the default is refused below rather than silently measured.
  const thinkWasExplicit =
    argv.includes("--think") || argv.includes("--no-think");
  const contract = (arg("contract") ?? "offsets") as AnchorContract;
  // Which prompt-service template to measure. `resolveAnalysisPrompt` resolves
  // `document-analysis-<documentType>`; this was pinned to the default, so
  // --contract quote-then-locate scored output produced by the OFFSETS template
  // and reported missing-anchor for every claim. A contract the prompt never
  // asked for measures nothing, and reads as the contract failing (#1212).
  const documentType = arg("document-type") ?? DEFAULT_DOCUMENT_TYPE;
  const limit = arg("limit") ? Number.parseInt(arg("limit")!, 10) : undefined;
  const pick = arg("measures")
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const source = JSON.parse(
    readFileSync(join(ROOT, "fixtures/fulltext-propositions.json"), "utf8"),
  ) as { items: SourceItem[] };
  const gold = JSON.parse(
    readFileSync(join(ROOT, "fixtures/gold-proposition-analysis.json"), "utf8"),
  ) as { items: GoldItem[] };

  const goldById = new Map(gold.items.map((g) => [g.externalId, g]));
  const selected = pick
    ? source.items.filter((i) => pick.includes(i.externalId))
    : source.items;
  const items = (limit ? selected.slice(0, limit) : selected).filter((i) =>
    goldById.has(i.externalId),
  );
  if (items.length === 0) {
    throw new Error(
      `No measures selected.${pick ? ` Asked for: ${pick.join(", ")}` : ""}`,
    );
  }

  // Probed BEFORE any generation: a run that cannot be attributed to a
  // digest and quantization is not worth the minutes it costs.
  const provenance: ModelProvenance = await probeModel(model);
  assertThinkDecided(provenance, thinkWasExplicit);

  const backend = createLlmBackend({ model, think });
  const db = new DbService();
  const results: MeasureResult[] = [];
  let prompt: Awaited<ReturnType<typeof resolveAnalysisPrompt>> | undefined;

  try {
    for (const item of items) {
      // Resolved per measure because the text is interpolated into it — and
      // verified against prompt-service every time, so a mid-run fallback
      // cannot silently change the instruction being measured.
      prompt = await resolveAnalysisPrompt(
        db,
        documentType,
        formatPropData(item),
      );

      process.stderr.write(`${item.externalId} (${item.chars} chars) ... `);
      const run = await backend.generate(prompt.promptText);
      const scored = scoreOne(
        item,
        goldById.get(item.externalId)!,
        run,
        contract,
      );
      results.push(scored);
      process.stderr.write(`${scored.json} ${(run.ms / 1000).toFixed(0)}s\n`);
    }
  } finally {
    await db.$disconnect().catch(() => undefined);
  }

  const header = [
    `${describeProvenance(provenance)} digest=${provenance.digest} ${provenance.parameterSize} ${provenance.architecture}`,
    `think=${think} maxTokens=${backend.maxTokens} contract=${contract}`,
    `prompt=${prompt?.templateName} ${prompt?.promptVersion} hash=${prompt?.promptHash.slice(0, 12)} (${prompt?.templateChars} chars)`,
    `measures=${results.length}`,
  ];
  console.log(`\n${report(results, header)}`);

  const out = {
    ranAt: new Date().toISOString(),
    model,
    provenance,
    think,
    maxTokens: backend.maxTokens,
    contract,
    documentType,
    calibration: scoreCalibration(results.flatMap((r) => r.claims)),
    prompt: prompt && {
      name: prompt.templateName,
      hash: prompt.promptHash,
      version: prompt.promptVersion,
      templateChars: prompt.templateChars,
    },
    results,
  };

  mkdirSync(join(ROOT, "results"), { recursive: true });
  // The slug carries the quantization: two quantizations of one model are
  // different measurements and must not overwrite each other. The template
  // joins it for the same reason — two templates scored under one contract are
  // two measurements — but only when non-default, so the recorded baselines
  // keep their filenames and stay comparable.
  const typeSuffix =
    documentType === DEFAULT_DOCUMENT_TYPE
      ? ""
      : `-${documentType.replace(/[^a-z0-9]+/gi, "-")}`;
  const slug = `${slugFor(provenance)}${think ? "-think" : ""}-${contract}${typeSuffix}`;
  const path = join(ROOT, "results", `generation-${slug}.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwritten: ${path.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
