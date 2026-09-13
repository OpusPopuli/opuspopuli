/**
 * OCR evaluation — does a photographed petition retrieve the measure it is of?
 *
 * The retrieval leg (`retrieval-eval.ts`) measures embeddings against typed
 * queries. This measures the step in front of it: a camera photograph, through
 * an OCR engine, through the same embeddings, against the same corpus.
 *
 * ── Why it needs no transcribed ground truth ──────────────────────────────
 *
 * The obvious way to score OCR is character error rate against a hand-typed
 * reference. That is expensive, and it measures the wrong thing: the product
 * does not need the text to be correct, it needs the text to RETRIEVE the
 * right measure. A scan can be full of character damage and still retrieve
 * perfectly, and a clean scan of the wrong region retrieves nothing.
 *
 * So the gold label is simply "which measure is this a photograph of", which
 * the photographer knows. Scoring is top-1 and margin over the real corpus,
 * exactly as the retrieval leg does.
 *
 * ── The row this exists to find ───────────────────────────────────────────
 *
 * `hit && !wouldPassGate` — the scan retrieves the correct measure, and the
 * production gate would have thrown it away unread.
 *
 * Observed in production 2026-09-13 before this harness existed: a scan at
 * page-confidence 45 whose middle 300 characters were a clean rendering of the
 * Attorney General's summary, with camera-background noise above and below.
 * The LLM read it and named the measure correctly; retrieval never ran,
 * because `MIN_RETRIEVAL_OCR_CONFIDENCE` is 70 and the page average is what it
 * compares. Every instance of that row is evidence the gate measures the wrong
 * quantity.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/eval-harness eval:ocr -- --engine tesseract
 *   pnpm --filter @opuspopuli/eval-harness eval:ocr -- --engine ollama-vision
 *   pnpm --filter @opuspopuli/eval-harness eval:ocr -- --engine text   # replay stored OCR
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Production's two gates, mirrored so the report can say what prod would do. */
const MIN_ANALYZABLE_OCR_CONFIDENCE = 40;
const MIN_RETRIEVAL_OCR_CONFIDENCE = 70;

interface ScanItem {
  /** Fixture id, e.g. "scan-0007A1-glare". */
  id: string;
  /** The measure this is a photograph of — the gold label. */
  gold: string;
  /** Image file under fixtures/scans/, omitted in `text` mode. */
  image?: string;
  /** Pre-extracted OCR text, for replaying a scan we cannot re-photograph. */
  text?: string;
  /** Page confidence recorded when the text was captured (`text` mode only). */
  recordedConfidence?: number;
  /** Free-form: lighting, distance, whether the crop fired. */
  notes?: string;
  /** True for deliberate negative controls — must NOT retrieve convincingly. */
  negative?: boolean;
}

interface ScanFixture {
  schemaVersion: number;
  kind: string;
  corpus: string;
  items: ScanItem[];
}

interface Doc {
  externalId: string;
  text: string;
}

interface OcrOut {
  text: string;
  /** Page-average confidence, 0-100, or null when the engine has no notion. */
  pageConfidence: number | null;
  /**
   * Confidence of the best contiguous text region, when the engine reports
   * per-block confidence. This is the candidate replacement for the page
   * average — computed here so the alternative can be MEASURED before anything
   * in production changes to use it.
   */
  bestRegionConfidence: number | null;
  ms: number;
}

interface OcrBackend {
  name: string;
  model: string;
  run(item: ScanItem): Promise<OcrOut>;
}

interface ScanResult {
  id: string;
  gold: string;
  negative: boolean;
  hit: boolean;
  rank: number;
  top1: string;
  margin: number;
  similarity: number;
  pageConfidence: number | null;
  bestRegionConfidence: number | null;
  wouldPassGate: boolean | null;
  chars: number;
  realWordRatio: number;
  ms: number;
  notes?: string;
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
 * Crude readability signal: the share of whitespace-separated tokens that look
 * like words rather than OCR debris.
 *
 * Deliberately not a dictionary. The #1074 measurement used "% real words" by
 * hand; this approximates it well enough to separate 4% from 91%, which is the
 * only distinction that has ever mattered here. It is reported, never gated on.
 */
function realWordRatio(text: string): number {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  const wordish = tokens.filter((t) => /^[A-Za-z][a-z]{2,}$/.test(t)).length;
  return wordish / tokens.length;
}

/** Replay text captured elsewhere — no image, no engine, just the scoring. */
function textBackend(): OcrBackend {
  return {
    name: "text",
    model: "(replay)",
    run: async (item) => {
      if (!item.text) {
        throw new Error(`item ${item.id} has no \`text\` for replay mode`);
      }
      return {
        text: item.text,
        pageConfidence: item.recordedConfidence ?? null,
        bestRegionConfidence: null,
        ms: 0,
      };
    },
  };
}

/** The shipped Tesseract path, including its preprocessing. */
async function tesseractBackend(): Promise<OcrBackend> {
  const mod = await import("@opuspopuli/ocr-provider");
  const P = (
    mod as unknown as {
      TesseractOcrProvider: new () => {
        extractText(input: { buffer: Buffer; mimeType: string }): Promise<{
          text: string;
          confidence: number;
          blocks?: { text: string; confidence: number }[];
        }>;
      };
    }
  ).TesseractOcrProvider;
  const provider = new P();

  return {
    name: "tesseract",
    model: "tesseract.js (shipped provider)",
    run: async (item) => {
      const buffer = readFileSync(scanPath(item));
      const started = Date.now();
      const out = await provider.extractText({
        buffer,
        mimeType: mimeFor(item.image ?? ""),
      });
      return {
        text: out.text,
        pageConfidence: out.confidence,
        bestRegionConfidence: bestRegion(out.blocks),
        ms: Date.now() - started,
      };
    },
  };
}

/**
 * A vision model reading the page directly.
 *
 * `qwen3.6:35b-a3b` already runs on the node as `LLM_MODEL` and reports
 * `vision` among its capabilities, so this costs no new pull. The prompt asks
 * for a verbatim transcription rather than a summary: the point is to feed
 * retrieval the measure's own words, and a model that helpfully paraphrases
 * would score well here while destroying the thing being measured.
 */
function ollamaVisionBackend(model: string): OcrBackend {
  const url = process.env.EMBEDDINGS_OLLAMA_URL ?? "http://localhost:11434";
  return {
    name: "ollama-vision",
    model,
    run: async (item) => {
      const b64 = readFileSync(scanPath(item)).toString("base64");
      const started = Date.now();
      const r = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt:
            "Transcribe all readable text from this photograph of a document, " +
            "verbatim and in reading order. Do not summarise, explain, or add " +
            "commentary. If a region is illegible, skip it rather than guessing.",
          images: [b64],
          stream: false,
          options: { temperature: 0 },
        }),
      });
      if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
      const data = (await r.json()) as { response?: string };
      return {
        text: data.response ?? "",
        // A VLM reports no per-character confidence. That is itself a finding:
        // an engine with no confidence signal cannot feed a confidence gate,
        // so adopting one means replacing the gate, not just the engine.
        pageConfidence: null,
        bestRegionConfidence: null,
        ms: Date.now() - started,
      };
    },
  };
}

function bestRegion(
  blocks?: { text: string; confidence: number }[],
): number | null {
  if (!blocks || blocks.length === 0) return null;
  // Longest-block confidence, not max: a two-character block at 99 says
  // nothing about whether the measure's text came through.
  const ranked = [...blocks].sort((a, b) => b.text.length - a.text.length);
  return ranked[0]?.confidence ?? null;
}

function scanPath(item: ScanItem): string {
  if (!item.image) throw new Error(`item ${item.id} has no image`);
  const p = join(ROOT, "fixtures/scans", item.image);
  if (!existsSync(p)) throw new Error(`missing fixture image: ${p}`);
  return p;
}

function mimeFor(file: string): string {
  if (/\.png$/i.test(file)) return "image/png";
  if (/\.webp$/i.test(file)) return "image/webp";
  return "image/jpeg";
}

/** The embeddings side, reusing the shipped provider — never a reimplementation. */
async function embedder(model: string) {
  const url = process.env.EMBEDDINGS_OLLAMA_URL ?? "http://localhost:11434";
  const mod = await import("@opuspopuli/embeddings-provider");
  const P = (
    mod as unknown as {
      OllamaEmbeddingProvider: new (
        baseUrl?: string,
        model?: string,
      ) => {
        getDimensions(): number;
        getModelName(): string;
        embedDocuments(t: string[]): Promise<number[][]>;
        embedQuery(q: string): Promise<number[]>;
      };
    }
  ).OllamaEmbeddingProvider;
  const p = new P(url, model);
  const probe = await p.embedQuery("dimension probe");
  if (probe.length !== p.getDimensions()) {
    throw new Error(
      `${model} declares ${p.getDimensions()} dimensions but returned ${probe.length}`,
    );
  }
  return p;
}

export async function runOcrEval(
  backend: OcrBackend,
  docs: Doc[],
  fixture: ScanFixture,
  embedModel: string,
): Promise<{
  ranAt: string;
  engine: string;
  model: string;
  embedModel: string;
  items: ScanResult[];
}> {
  const embed = await embedder(embedModel);
  const docVecs = await embed.embedDocuments(docs.map((d) => d.text));

  const items: ScanResult[] = [];
  for (const item of fixture.items) {
    const ocr = await backend.run(item);
    const qv = await embed.embedQuery(ocr.text);

    const scored = docs
      .map((d, i) => ({ id: d.externalId, score: cos(qv, docVecs[i]) }))
      .sort((a, b) => b.score - a.score);
    const order = scored.map((s) => s.id);
    const rank = order.indexOf(item.gold) + 1;
    const bestOther = scored.find((s) => s.id !== item.gold);

    items.push({
      id: item.id,
      gold: item.gold,
      negative: item.negative ?? false,
      hit: rank === 1,
      rank,
      top1: order[0],
      similarity: scored[0].score,
      margin: scored[0].score - (bestOther?.score ?? 0),
      pageConfidence: ocr.pageConfidence,
      bestRegionConfidence: ocr.bestRegionConfidence,
      wouldPassGate:
        ocr.pageConfidence === null
          ? null
          : ocr.pageConfidence >= MIN_RETRIEVAL_OCR_CONFIDENCE,
      chars: ocr.text.length,
      realWordRatio: realWordRatio(ocr.text),
      ms: ocr.ms,
      notes: item.notes,
    });
  }

  return {
    ranAt: new Date().toISOString(),
    engine: backend.name,
    model: backend.model,
    embedModel,
    items,
  };
}

function report(run: Awaited<ReturnType<typeof runOcrEval>>): string {
  const lines: string[] = [];
  lines.push(
    `engine=${run.engine} model=${run.model} embed=${run.embedModel}`,
    "",
  );

  const positives = run.items.filter((i) => !i.negative);
  const hits = positives.filter((i) => i.hit).length;
  const gated = positives.filter((i) => i.hit && i.wouldPassGate === false);

  lines.push(
    `retrieval: ${hits}/${positives.length} correct measure at rank 1`,
    "",
  );
  lines.push(
    "id                        hit  rank  sim     margin  pageConf  bestRegion  gate   words  chars",
  );
  for (const i of run.items) {
    lines.push(
      [
        i.id.padEnd(24),
        (i.hit ? " ✓ " : " ✗ ").padEnd(4),
        String(i.rank).padStart(4),
        i.similarity.toFixed(4).padStart(7),
        i.margin.toFixed(4).padStart(7),
        (i.pageConfidence?.toFixed(0) ?? "-").padStart(9),
        (i.bestRegionConfidence?.toFixed(0) ?? "-").padStart(11),
        (i.wouldPassGate === null
          ? "-"
          : i.wouldPassGate
            ? "pass"
            : "SKIP"
        ).padStart(6),
        (i.realWordRatio * 100).toFixed(0).padStart(6) + "%",
        String(i.chars).padStart(6),
      ].join(""),
    );
  }

  if (gated.length > 0) {
    lines.push(
      "",
      `⚠ ${gated.length} scan(s) retrieved the CORRECT measure but production would have`,
      `  skipped them unread (page confidence < ${MIN_RETRIEVAL_OCR_CONFIDENCE}):`,
    );
    for (const g of gated) {
      lines.push(
        `    ${g.id}  conf=${g.pageConfidence?.toFixed(0)}  margin=${g.margin.toFixed(4)}` +
          (g.bestRegionConfidence !== null
            ? `  bestRegion=${g.bestRegionConfidence.toFixed(0)}`
            : ""),
      );
    }
  }

  const negatives = run.items.filter((i) => i.negative);
  if (negatives.length > 0) {
    lines.push("", "negative controls (must not retrieve convincingly):");
    for (const n of negatives) {
      lines.push(
        `    ${n.id}  top1=${n.top1}  sim=${n.similarity.toFixed(4)}  margin=${n.margin.toFixed(4)}`,
      );
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

  const engine = arg("engine") ?? "text";
  const embedModel = arg("embed-model") ?? "nomic-embed-text-v2-moe:latest";
  const fixtureFile = arg("fixture") ?? "fixtures/scans.json";

  const fixture = JSON.parse(
    readFileSync(join(ROOT, fixtureFile), "utf8"),
  ) as ScanFixture;
  const docs = JSON.parse(
    readFileSync(join(ROOT, "fixtures/corpus-propositions.json"), "utf8"),
  ) as Doc[];

  let backend: OcrBackend;
  if (engine === "text") backend = textBackend();
  else if (engine === "tesseract") backend = await tesseractBackend();
  else if (engine === "ollama-vision")
    backend = ollamaVisionBackend(arg("model") ?? "qwen3.6:35b-a3b");
  else throw new Error(`unknown engine "${engine}"`);

  const run = await runOcrEval(backend, docs, fixture, embedModel);
  console.log(report(run));

  mkdirSync(join(ROOT, "results"), { recursive: true });
  const slug = `ocr-${run.engine}-${run.model.replace(/[^a-z0-9]+/gi, "-")}`;
  const out = join(ROOT, "results", `${slug}.json`);
  writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nwritten: ./results/${slug}.json`);
}

void main();
