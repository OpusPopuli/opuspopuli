/**
 * Retrieval evaluation harness — the baseline instrument (M4 / roadmap R3).
 *
 * Measures retrieval quality over the real proposition corpus using the
 * SAME embeddings providers production uses, so a result here describes the
 * shipped system rather than a reimplementation of it.
 *
 * Why this exists, stated plainly: several confident claims about retrieval
 * in this project turned out to be wrong when measured — that a 768-dim
 * multilingual model must beat a 384-dim MiniLM (it did not, on English),
 * that Metal-backed inference would be faster (it was ~73x slower per query),
 * that nomic v1.5 was a viable fallback (0/14 on this corpus). Every future
 * retrieval change should be able to say what it did to these numbers.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/eval-harness eval:retrieval -- --provider xenova
 *   pnpm --filter @opuspopuli/eval-harness eval:retrieval -- --provider ollama \
 *       --model nomic-embed-text-v2-moe:latest --prefix
 *
 * Results are written to results/ as JSON, keyed by provider+model, so runs
 * are comparable over time rather than scrolling past in a terminal.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

interface EvalItem {
  id: string;
  lang: string;
  query: string;
  gold: string[];
  difficulty: string;
  notes?: string;
}

interface Fixture {
  schemaVersion: number;
  kind: string;
  corpus: string;
  items: EvalItem[];
}

interface Doc {
  externalId: string;
  text: string;
}

export interface ItemResult {
  id: string;
  lang: string;
  difficulty: string;
  rank: number;
  hit: boolean;
  top1: string;
  /** Top score minus the best score belonging to a NON-gold document. */
  margin: number;
}

export interface EvalRun {
  ranAt: string;
  provider: string;
  model: string;
  dimensions: number;
  prefixed: boolean;
  corpusSize: number;
  itemCount: number;
  overall: Metrics;
  byLang: Record<string, Metrics>;
  /** Query-independent: how well the model spreads this corpus apart. */
  corpusSeparation: { min: number; mean: number; max: number };
  items: ItemResult[];
}

interface Metrics {
  n: number;
  top1: number;
  top1Rate: number;
  mrr: number;
  meanMargin: number;
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

const metrics = (rows: ItemResult[]): Metrics => {
  const n = rows.length;
  if (n === 0) {
    return { n: 0, top1: 0, top1Rate: 0, mrr: 0, meanMargin: 0 };
  }
  const top1 = rows.filter((r) => r.hit).length;
  return {
    n,
    top1,
    top1Rate: top1 / n,
    mrr: rows.reduce((s, r) => s + 1 / r.rank, 0) / n,
    meanMargin: rows.reduce((s, r) => s + r.margin, 0) / n,
  };
};

/** Embedding backends, matched to what production can be configured to run. */
interface Backend {
  name: string;
  model: string;
  dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

async function ollamaBackend(
  model: string,
  prefixed: boolean,
): Promise<Backend> {
  const url = process.env.EMBEDDINGS_OLLAMA_URL ?? "http://localhost:11434";

  // The SHIPPED provider, not an inline fetch.
  //
  // This backend used to reimplement the /api/embed call here, including its
  // own task prefixing. That made the nomic leg — the one the R1 decision
  // rests on — a measurement of a reimplementation, while the xenova leg below
  // measured the real provider. A harness that exists because confident claims
  // kept turning out wrong should not itself be measuring code that production
  // does not run. The provider now owns batching, prefixes and the dimension
  // map (#1156 slice A), so there is nothing left to duplicate.
  const mod = await import("@opuspopuli/embeddings-provider");
  const P = (
    mod as unknown as {
      OllamaEmbeddingProvider: new (
        baseUrl?: string,
        model?: string,
        fetchFn?: unknown,
        options?: { taskPrefixes?: boolean; batchSize?: number },
      ) => {
        getModelName(): string;
        getDimensions(): number;
        embedDocuments(t: string[]): Promise<number[][]>;
        embedQuery(q: string): Promise<number[]>;
      };
    }
  ).OllamaEmbeddingProvider;

  const p = new P(url, model, undefined, { taskPrefixes: prefixed });

  // Declared width vs actual width. `getDimensions()` reads a static map; this
  // is the one place that can catch a wrong entry in it against the model that
  // actually answers, which is exactly the failure the map replaced.
  const probe = await p.embedQuery("dimension probe");
  if (probe.length !== p.getDimensions()) {
    throw new Error(
      `${model} declares ${p.getDimensions()} dimensions but returned ${probe.length}`,
    );
  }

  return {
    name: "ollama",
    model: p.getModelName(),
    dimensions: p.getDimensions(),
    embedDocuments: (t) => p.embedDocuments(t),
    embedQuery: (q) => p.embedQuery(q),
  };
}

async function xenovaBackend(model?: string): Promise<Backend> {
  // Takes a model so the in-process path can be measured at widths other than
  // MiniLM's 384. After the R1 cutover `EMBEDDING_DIMENSIONS` is 768, and a
  // zero-setup path that stays selectable has to produce 768 too (#1156 §4.5)
  // — which candidate does that acceptably is a question for this harness, not
  // for a judgement call.
  //
  // Imported lazily: pulling the in-process transformers runtime costs seconds
  // and is pointless when measuring the Ollama path.
  const mod = await import("@opuspopuli/embeddings-provider");
  const P = (
    mod as unknown as {
      XenovaEmbeddingProvider: new (model?: string) => {
        getModelName?: () => string;
        getDimensions(): number;
        embedDocuments(t: string[]): Promise<number[][]>;
        embedQuery(q: string): Promise<number[]>;
      };
    }
  ).XenovaEmbeddingProvider;
  const p = new P(model);

  // Same declared-vs-actual check as the ollama leg. `getDimensionsForModel`
  // in xenova.provider.ts is still a chain of `includes()` tests ending in
  // `return 384` for anything unrecognised, so a model passed via --model can
  // report a width it does not produce — and a harness reporting the wrong
  // dimension is a harness producing a number nobody can trust.
  const probe = await p.embedQuery("warmup");
  if (probe.length !== p.getDimensions()) {
    throw new Error(
      `${p.getModelName?.() ?? model} declares ${p.getDimensions()} dimensions but returned ${probe.length}`,
    );
  }

  return {
    name: "xenova",
    model: p.getModelName?.() ?? "Xenova/all-MiniLM-L6-v2",
    dimensions: p.getDimensions(),
    embedDocuments: (t) => p.embedDocuments(t),
    embedQuery: (q) => p.embedQuery(q),
  };
}

export async function runEval(
  backend: Backend,
  docs: Doc[],
  fixture: Fixture,
  prefixed: boolean,
): Promise<EvalRun> {
  const docVecs = await backend.embedDocuments(docs.map((d) => d.text));

  // Query-independent signal: a model that maps every document to nearly the
  // same point cannot rank them, whatever the queries say. nomic v1.5 scored
  // 0.942 mean here and returned 0/14 — the pairwise figure predicted it.
  const pairs: number[] = [];
  for (let i = 0; i < docVecs.length; i++) {
    for (let j = i + 1; j < docVecs.length; j++) {
      pairs.push(cos(docVecs[i], docVecs[j]));
    }
  }
  pairs.sort((a, b) => a - b);

  const items: ItemResult[] = [];
  for (const item of fixture.items) {
    const qv = await backend.embedQuery(item.query);
    const scored = docs
      .map((d, i) => ({ id: d.externalId, score: cos(qv, docVecs[i]) }))
      .sort((a, b) => b.score - a.score);

    const order = scored.map((s) => s.id);
    const rank = Math.min(...item.gold.map((g) => order.indexOf(g))) + 1;
    // Margin against the best NON-gold document. Measuring against scored[1]
    // would punish a model for ranking two genuine duplicates 1st and 2nd,
    // which is correct behaviour on this corpus.
    const bestOther = scored.find((s) => !item.gold.includes(s.id));
    items.push({
      id: item.id,
      lang: item.lang,
      difficulty: item.difficulty,
      rank,
      hit: rank === 1,
      top1: order[0],
      margin: scored[0].score - (bestOther?.score ?? 0),
    });
  }

  const langs = [...new Set(items.map((i) => i.lang))].sort();
  return {
    ranAt: new Date().toISOString(),
    provider: backend.name,
    model: backend.model,
    dimensions: backend.dimensions,
    prefixed,
    corpusSize: docs.length,
    itemCount: items.length,
    overall: metrics(items),
    byLang: Object.fromEntries(
      langs.map((l) => [l, metrics(items.filter((i) => i.lang === l))]),
    ),
    corpusSeparation: {
      min: pairs[0],
      mean: pairs.reduce((a, b) => a + b, 0) / pairs.length,
      max: pairs[pairs.length - 1],
    },
    items,
  };
}

function report(run: EvalRun): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `provider=${run.provider} model=${run.model} dims=${run.dimensions} prefixed=${run.prefixed}`,
    `corpus=${run.corpusSize} docs, items=${run.itemCount}`,
    "",
    `overall   top1=${run.overall.top1}/${run.overall.n} (${pct(run.overall.top1Rate)})  MRR=${run.overall.mrr.toFixed(3)}  margin=${run.overall.meanMargin.toFixed(4)}`,
  ];
  for (const [lang, m] of Object.entries(run.byLang)) {
    lines.push(
      `  ${lang.padEnd(6)}  top1=${m.top1}/${m.n} (${pct(m.top1Rate)})  MRR=${m.mrr.toFixed(3)}  margin=${m.meanMargin.toFixed(4)}`,
    );
  }
  const s = run.corpusSeparation;
  lines.push(
    "",
    `corpus separation (query-independent): min=${s.min.toFixed(3)} mean=${s.mean.toFixed(3)} max=${s.max.toFixed(3)}`,
  );
  const misses = run.items.filter((i) => !i.hit);
  if (misses.length) {
    lines.push("", "misses:");
    for (const m of misses) {
      lines.push(`  ${m.id} [${m.lang}] rank=${m.rank} got=${m.top1}`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = arg("provider") ?? "xenova";
  const prefixed = argv.includes("--prefix");

  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/retrieval-propositions.json"), "utf8"),
  ) as Fixture;
  const docs = JSON.parse(
    readFileSync(join(ROOT, "fixtures/corpus-propositions.json"), "utf8"),
  ) as Doc[];

  const backend =
    provider === "ollama"
      ? await ollamaBackend(
          arg("model") ?? "nomic-embed-text-v2-moe:latest",
          prefixed,
        )
      : await xenovaBackend(arg("model"));

  const run = await runEval(backend, docs, fixture, prefixed);
  console.log(report(run));

  mkdirSync(join(ROOT, "results"), { recursive: true });
  const slug = `${run.provider}-${run.model.replace(/[^a-z0-9]+/gi, "-")}${prefixed ? "-prefixed" : ""}`;
  const out = join(ROOT, "results", `retrieval-${slug}.json`);
  writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nwritten: ${out.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
