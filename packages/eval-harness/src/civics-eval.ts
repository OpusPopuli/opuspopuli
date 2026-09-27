/**
 * Civics extraction eval — is this model BETTER, not just different?
 *
 * Four civics syncs after the 2026-09-24 model switch produced a clear picture of
 * change and none of quality: glossary 30 -> 254 terms on one page, five lifecycle
 * stage ids lost on another, three pages extracting to nothing, 89% of the
 * previous total content. All diffs. "89% of baseline" only means something if the
 * baseline was right, and it partly was not — qwen stored page headings as
 * lifecycle stage NAMES.
 *
 * So this scores against `fixtures/gold-civics.json`, a reference neither model
 * produced, whose every item is a verbatim quote from the text the model receives.
 *
 * ## Candidates
 *
 *   --candidate baseline   the qwen rows captured before the switch. No inference:
 *                          reads fixtures/civics-baseline-qwen.json.
 *   --candidate model      runs the REAL civics-extraction prompt from
 *                          prompt-service through a model, as the service does.
 *
 * ## Source text
 *
 * By default the gold set's own `extractedTextForAudit` — the exact text each gold
 * item was authored against. That makes runs reproducible and comparable, and
 * keeps page drift out of a model comparison. `--live` refetches instead, which is
 * how you find out the page has changed; expect gold quotes to stop resolving when
 * it has, and treat that as a signal rather than a failure.
 *
 * ## Determinism
 *
 * Extraction is unseeded in production deliberately (#1327 — a fixed seed would
 * make a page that extracts on half its attempts fail on ALL of them, forever).
 * An eval needs the opposite, so this pins CIVICS_EXTRACTION_SEED unless told not
 * to. Two identical syncs disagreed about 2 of 24 pages; a prompt comparison
 * without a seed measures that variance as well as the change.
 *
 * ## Usage
 *
 *   pnpm --filter @opuspopuli/eval-harness eval:civics                  # qwen baseline
 *   pnpm --filter @opuspopuli/eval-harness eval:civics -- \
 *     --candidate model --models nemotron-3.5-lightning:30b-a3b
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractJsonObjectSlice, htmlToReadableText } from "@opuspopuli/common";

import { assertFreshBuilds } from "./build-freshness.js";
import {
  scoreField,
  summarisePage,
  type EmittedItem,
  type FieldScore,
  type GoldCivicsField,
  type Similarity,
} from "./scoring/civics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Gold fields map 1:1 onto the CivicsBlock JSON keys a model returns. */
const FIELD_KEYS: Record<string, string> = {
  chambers: "chambers",
  measureTypes: "measureTypes",
  lifecycleStages: "lifecycleStages",
  sessionScheme: "sessionScheme",
  glossary: "glossary",
};

/** Baseline rows use snake_case, being a database snapshot. */
const BASELINE_KEYS: Record<string, string> = {
  chambers: "chambers",
  measureTypes: "measure_types",
  lifecycleStages: "lifecycle_stages",
  sessionScheme: "session_scheme",
  glossary: "glossary",
};

interface GoldPage {
  sourceUrl: string;
  extractedTextForAudit: string;
  why?: string;
  fields: Record<string, GoldCivicsField>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/**
 * Flatten whatever a candidate produced for one field into scoreable claims.
 *
 * Only the VERBATIM half of a `{verbatim, plainLanguage}` pair is a claim about
 * the page; `plainLanguage` is an AI rewrite and scoring it as ungrounded would
 * penalise the feature. Falls back to a plain string, or a `name`/`term`/`label`,
 * which is the shape both models actually emit.
 */
export function flattenEmitted(value: unknown): EmittedItem[] {
  const items: EmittedItem[] = [];
  const push = (raw: unknown, subFields?: string[]) => {
    if (typeof raw === "string" && raw.trim()) {
      items.push({ verbatim: raw.trim(), ...(subFields ? { subFields } : {}) });
    }
  };
  const fromObject = (o: Record<string, unknown>) => {
    const subFields = Object.keys(o);
    for (const key of ["term", "name", "label", "title"]) {
      const v = o[key];
      if (typeof v === "string") return push(v, subFields);
      if (v && typeof v === "object") {
        const verbatim = (v as Record<string, unknown>).verbatim;
        if (typeof verbatim === "string") return push(verbatim, subFields);
      }
    }
    // No obvious label: fall back to a verbatim field if the object has one.
    const verbatim = o.verbatim;
    if (typeof verbatim === "string") push(verbatim, subFields);
  };

  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") push(v);
      else if (v && typeof v === "object")
        fromObject(v as Record<string, unknown>);
    }
  } else if (value && typeof value === "object") {
    fromObject(value as Record<string, unknown>);
  }
  return items;
}

/**
 * Similarity without an embedder: normalised containment either way.
 *
 * Deliberately simple and stated as such. `scoring/omission.ts` calibrates a
 * cosine threshold against an embedding model, which is better for paraphrase and
 * is the upgrade path here — but it needs an embeddings provider running, and the
 * first question this eval has to answer is "did the model produce anything at
 * all for a field", where containment is sufficient and auditable.
 *
 * Reported in the output as the matcher used, so a number can never be read as
 * more precise than the method behind it.
 */
export function containmentSimilarity(
  goldTexts: string[],
  emitted: EmittedItem[],
): Similarity {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const g = goldTexts.map(norm);
  const e = emitted.map((x) => norm(x.verbatim));
  return (gi, ei) => {
    const a = g[gi];
    const b = e[ei];
    if (!a || !b) return 0;
    if (a === b) return 1;
    // A gold item is phrased as a description ("Initiative Statute, requiring
    // 546,651 signatures"); an emitted label is usually the shorter of the two.
    if (a.includes(b) || b.includes(a)) return 0.8;
    return 0;
  };
}

interface Candidate {
  name: string;
  /** field key -> whatever was produced for it */
  blockFor(sourceUrl: string): Promise<Record<string, unknown> | undefined>;
}

function baselineCandidate(): Candidate {
  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/civics-baseline-qwen.json"), "utf8"),
  ) as { blocks: Record<string, unknown>[] };
  return {
    name: "qwen-baseline (fixture, no inference)",
    blockFor: (url) =>
      Promise.resolve(
        fixture.blocks.find((b) => b.source_url === url) as
          | Record<string, unknown>
          | undefined,
      ),
  };
}

/**
 * Runs the real prompt through a model, as the region service does.
 *
 * Goes through `PromptClientService` rather than any prompt text in this file —
 * prompt templates live in prompt-service and are never inlined here. With
 * PROMPT_SERVICE_URL unset the client resolves from the local database, which is
 * the normal way to run this harness.
 */
async function modelCandidate(model: string): Promise<Candidate> {
  const { PromptClientService } = await import("@opuspopuli/prompt-client");
  const { DbService } = await import("@opuspopuli/relationaldb-provider");
  const { OllamaLLMProvider } = await import("@opuspopuli/llm-provider");

  const db = new DbService();
  const client = new PromptClientService(db, {
    promptServiceUrl: process.env.PROMPT_SERVICE_URL,
    promptServiceApiKey: process.env.PROMPT_SERVICE_API_KEY,
    hmacNodeId: process.env.PROMPT_SERVICE_NODE_ID,
  });
  const provider = new OllamaLLMProvider({
    url: process.env.OLLAMA_URL ?? "http://localhost:11434",
    model,
    requestTimeoutMs: 3_600_000,
    ...(process.env.LLM_INGESTION_CONTEXT_TOKENS
      ? { contextTokens: Number(process.env.LLM_INGESTION_CONTEXT_TOKENS) }
      : {}),
  });

  const seed = flag("no-seed") ? undefined : Number(arg("seed") ?? 7);

  return {
    name: `${model}${seed === undefined ? " (unseeded)" : ` (seed ${seed})`}`,
    async blockFor(sourceUrl) {
      const { promptText } = await client.getCivicsExtractionPrompt({
        regionId: "california",
        sourceUrl,
        contentGoal: "civics structure",
        category: "",
        hints: [],
        html: SOURCE_TEXT.get(sourceUrl) ?? "",
      } as never);
      const result = await provider.generate(promptText, {
        maxTokens: 64000,
        temperature: 0.1,
        ...(seed === undefined ? {} : { seed }),
      });
      const slice = extractJsonObjectSlice(result.text);
      if (!slice) {
        console.log(`   (no JSON object returned for ${sourceUrl})`);
        return undefined;
      }
      try {
        return JSON.parse(slice) as Record<string, unknown>;
      } catch (e) {
        console.log(`   (unparseable JSON: ${(e as Error).message})`);
        return undefined;
      }
    },
  };
}

/**
 * The data source whose hints govern a page, and the hint text itself.
 *
 * `hints` and `contentGoal` are part of the prompt, and the California config is
 * prescriptive to the point of naming ids and vote thresholds — the Secretary of
 * State source instructs "Initiative Statute, Initiative Constitutional
 * Amendment, Referendum, Recall" and four kebab-case stage ids outright. Scoring
 * a model's output against page text alone marked every one of those as a
 * fabrication, which is how this eval's first run got the answer backwards.
 *
 * Each gold page is a crawled sub-page, so its governing source is the configured
 * seed with the longest shared URL prefix.
 */
async function loadHintsByPage(
  pageUrls: string[],
): Promise<Map<string, string>> {
  const { getRegionsDir } = await import("@opuspopuli/region-provider");
  const { readFileSync: read } = await import("node:fs");
  const cfg = JSON.parse(
    read(join(getRegionsDir(), "california", "california.json"), "utf8"),
  ) as unknown;

  const sources: { url: string; contentGoal?: string; hints?: string[] }[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    if (r.dataType === "civics" && typeof r.url === "string") {
      sources.push({
        url: r.url,
        contentGoal:
          typeof r.contentGoal === "string" ? r.contentGoal : undefined,
        hints: Array.isArray(r.hints) ? (r.hints as string[]) : undefined,
      });
    }
    Object.values(r).forEach(walk);
  };
  walk(cfg);

  const shared = (a: string, b: string) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };

  const out = new Map<string, string>();
  for (const pageUrl of pageUrls) {
    let best: (typeof sources)[number] | undefined;
    let bestLen = 0;
    for (const s of sources) {
      const n = shared(pageUrl, s.url);
      if (n > bestLen) {
        bestLen = n;
        best = s;
      }
    }
    out.set(
      pageUrl,
      best ? [best.contentGoal ?? "", ...(best.hints ?? [])].join("\n") : "",
    );
  }
  return out;
}

/** Populated before candidates run, so the model sees exactly what gold used. */
const SOURCE_TEXT = new Map<string, string>();

async function main(): Promise<void> {
  assertFreshBuilds();

  const gold = JSON.parse(
    readFileSync(join(ROOT, "fixtures/gold-civics.json"), "utf8"),
  ) as { pages: GoldPage[] };

  const live = flag("live");
  for (const page of gold.pages) {
    if (live) {
      const res = await fetch(page.sourceUrl, {
        signal: AbortSignal.timeout(45_000),
        headers: { "user-agent": "opuspopuli-eval-harness" },
      });
      SOURCE_TEXT.set(page.sourceUrl, htmlToReadableText(await res.text()));
    } else {
      SOURCE_TEXT.set(page.sourceUrl, page.extractedTextForAudit);
    }
  }

  const hintsByPage = await loadHintsByPage(gold.pages.map((p) => p.sourceUrl));

  const which = arg("candidate") ?? "baseline";
  const candidate =
    which === "model"
      ? await modelCandidate(arg("models") ?? "nemotron-3.5-lightning:30b-a3b")
      : baselineCandidate();

  console.log(`candidate: ${candidate.name}`);
  console.log(
    `source text: ${live ? "LIVE fetch" : "gold extractedTextForAudit"}`,
  );
  console.log(`matcher: normalised containment (see containmentSimilarity)`);
  console.log(`warrant: page text OR the source's curated hints\n`);

  const report: unknown[] = [];
  for (const page of gold.pages) {
    const sourceText = SOURCE_TEXT.get(page.sourceUrl) ?? "";
    const block = await candidate.blockFor(page.sourceUrl);
    const keys = which === "model" ? FIELD_KEYS : BASELINE_KEYS;

    const scores: FieldScore[] = Object.entries(page.fields).map(
      ([fieldName, goldField]) => {
        const emitted = flattenEmitted(block?.[keys[fieldName] ?? fieldName]);
        const goldTexts = (goldField.items ?? []).map((i) => i.text);
        return scoreField(
          fieldName,
          goldField,
          emitted,
          sourceText,
          containmentSimilarity(goldTexts, emitted),
          0.6,
          hintsByPage.get(page.sourceUrl) ?? "",
        );
      },
    );

    const verdict = summarisePage(scores);
    const short = page.sourceUrl.split("/").filter(Boolean).pop();
    console.log(`${short}`);
    const byPage = scores.reduce((n, f) => n + f.warrantedByPage, 0);
    const byHint = scores.reduce((n, f) => n + f.warrantedByHint, 0);
    console.log(
      `   recall ${verdict.meanRecall ?? "n/a"}  precision ${verdict.meanPrecision ?? "n/a"}` +
        `  warranted: ${byPage} page / ${byHint} hint  ungrounded ${verdict.ungroundedCount}`,
    );
    if (verdict.emptied.length)
      console.log(
        `   EMPTY where gold has content: ${verdict.emptied.join(", ")}`,
      );
    if (verdict.invented.length)
      console.log(
        `   INVENTED where gold expects empty: ${verdict.invented.join(", ")}`,
      );
    for (const f of scores) {
      if (f.ungrounded.length) {
        console.log(`   ungrounded in ${f.field}:`);
        for (const u of f.ungrounded.slice(0, 4))
          console.log(`      ${JSON.stringify(u)}`);
      }
    }
    console.log();
    report.push({ sourceUrl: page.sourceUrl, verdict });
  }

  const out = arg("out") ?? join(ROOT, "results", "civics-eval.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        candidate: candidate.name,
        sourceText: live ? "live" : "gold-recorded",
        matcher: "normalised-containment",
        pages: report,
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
