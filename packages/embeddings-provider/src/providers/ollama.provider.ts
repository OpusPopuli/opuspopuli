import { Injectable, Logger } from "@nestjs/common";
import {
  IEmbeddingProvider,
  EmbeddingError,
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  CircuitBreakerHealth,
} from "@opuspopuli/common";

/**
 * Custom fetch function type for HTTP connection pooling support
 */
export type FetchFunction = (
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>;

/**
 * Known model → embedding width.
 *
 * This was a ternary — `model === "mxbai-embed-large" ? 1024 : 768` — which
 * returned 768 for *anything* it did not recognise. That is correct for
 * nomic-embed-text-v2-moe by luck rather than by knowledge, and wrong for
 * `mxbai-embed-large:latest`: with the tag attached the equality fails and a
 * 1024-wide model declares itself 768. Nothing errors. The width is what the
 * startup assertion and the `vector(N)` columns are checked against, so a
 * mis-declared width is not a cosmetic bug — it silently corrupts every
 * comparison made against those vectors.
 *
 * Keys are tag-stripped and lower-cased (see `normalizeModelName`). An unknown
 * model throws: a wrong width that fails at boot costs minutes, and one that
 * survives boot costs a corpus.
 */
const MODEL_DIMENSIONS: Readonly<Record<string, number>> = {
  // The production model. Multilingual (the reason it was chosen — 8/8 ES on
  // the eval-harness corpus against MiniLM's 5/8, and its hits clear the
  // next-best answer by 0.223 where MiniLM clears by 0.036).
  "nomic-embed-text-v2-moe": 768,
  // v1.5. Listed because its width is a fact worth recording, NOT because it
  // is a fallback: it scores 0/14 top-1 (MRR 0.108) on the proposition corpus,
  // whose AG boilerplate saturates its similarity space (pairwise cosine mean
  // 0.942). See packages/eval-harness and the roadmap §1.3.
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
};

/**
 * `nomic-embed-text-v2-moe:latest` and `nomic-embed-text-v2-moe` are the same
 * model. Ollama treats an absent tag as `:latest`, so the lookup key has to be
 * the tag-stripped name or the map develops one entry per tag anyone happens
 * to type.
 */
function normalizeModelName(model: string): string {
  return model.trim().toLowerCase().split(":")[0];
}

/** `foo` and `foo:latest` are the same model to Ollama; compare them that way. */
function withDefaultTag(model: string): string {
  const name = model.trim().toLowerCase();
  return name.includes(":") ? name : `${name}:latest`;
}

function dimensionsForModel(model: string): number {
  const dimensions = MODEL_DIMENSIONS[normalizeModelName(model)];
  if (dimensions === undefined) {
    throw new Error(
      `Unknown embedding model "${model}". Add it to MODEL_DIMENSIONS in ` +
        `ollama.provider.ts with its measured width. Guessing a width ` +
        `mis-declares the vector and every comparison made against it — ` +
        `known: ${Object.keys(MODEL_DIMENSIONS).join(", ")}.`,
    );
  }
  return dimensions;
}

/**
 * How many texts go in one `/api/embed` call.
 *
 * Not unbounded: a backfill over the bills corpus is thousands of rows, and
 * one request carrying all of them is a request body and a response no one
 * measured, against a server that also runs the nightly LLM cron.
 */
const DEFAULT_BATCH_SIZE = 64;

/**
 * Task prefixes required by the nomic model card.
 *
 * `ollama show --template` confirms the template is a bare `{{ .Prompt }}`, so
 * Ollama does not add these — the application must, if they are used at all.
 * Measured on the proposition corpus (#1156, 2026-09-10): 8/8 correct both
 * ways, mean margin 0.160 prefixed vs 0.168 unprefixed. Within noise at that
 * sample size, which is why this is configurable and defaults to off rather
 * than being applied because the model card says so.
 *
 * The asymmetry is the point: a document and a query are embedded for
 * different purposes, and `IEmbeddingProvider` already splits the two calls.
 */
const DOCUMENT_PREFIX = "search_document: ";
const QUERY_PREFIX = "search_query: ";

export interface OllamaEmbeddingOptions {
  /** Apply the model card's `search_document:`/`search_query:` prefixes. */
  taskPrefixes?: boolean;
  /** Texts per `/api/embed` call. Defaults to 64. */
  batchSize?: number;
}

/**
 * Ollama Embedding Provider (OSS)
 *
 * Uses Ollama for local embedding generation.
 * Models: nomic-embed-text-v2-moe (multilingual, 768d), mxbai-embed-large.
 *
 * Setup:
 * 1. Install Ollama: https://ollama.ai
 * 2. Pull model: ollama pull nomic-embed-text-v2-moe
 * 3. Run: ollama serve (default port 11434)
 */
@Injectable()
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(OllamaEmbeddingProvider.name);
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly fetchFn: FetchFunction;
  private readonly taskPrefixes: boolean;
  private readonly batchSize: number;
  private baseUrl: string;
  private model: string;
  private dimensions: number;

  constructor(
    baseUrl?: string,
    model?: string,
    fetchFn?: FetchFunction,
    options: OllamaEmbeddingOptions = {},
  ) {
    this.baseUrl = baseUrl || "http://localhost:11434";
    // Defaults to v2-moe. Plain `nomic-embed-text` is v1.5 and is NOT an
    // equivalent: it measures 0/14 on this corpus (see eval-harness).
    this.model = model || "nomic-embed-text-v2-moe:latest";
    this.dimensions = dimensionsForModel(this.model);
    this.taskPrefixes = options.taskPrefixes ?? false;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

    // `Number.isInteger` first, and not just `< 1`: a NaN batchSize (an
    // unparseable EMBEDDINGS_OLLAMA_BATCH_SIZE reaching a direct constructor
    // call) fails every comparison, so `< 1` would pass it through — and then
    // `i += NaN` never enters the loop and embedDocuments returns an empty
    // array having embedded nothing, with no error anywhere.
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new Error(
        `Ollama embeddings batchSize must be a positive integer, got ${this.batchSize}`,
      );
    }

    // Use custom fetch function if provided, otherwise use native fetch
    // Native fetch respects global dispatcher set via setGlobalHttpPool()
    this.fetchFn = fetchFn ?? fetch;

    this.logger.log(
      `Initialized Ollama embeddings at ${this.baseUrl} with model: ${this.model} ` +
        `(${this.dimensions}d, batch ${this.batchSize}, ` +
        `task prefixes ${this.taskPrefixes ? "on" : "off"})`,
    );

    // Initialize circuit breaker for Ollama calls
    this.circuitBreaker = createCircuitBreaker(DEFAULT_CIRCUIT_CONFIGS.ollama);

    // Log circuit state changes
    this.circuitBreaker.addListener((event) => {
      switch (event) {
        case "break":
          this.logger.warn(
            `Circuit breaker OPENED for Ollama Embeddings - service unavailable`,
          );
          break;
        case "reset":
          this.logger.log(
            `Circuit breaker RESET for Ollama Embeddings - service recovered`,
          );
          break;
        case "half_open":
          this.logger.log(
            `Circuit breaker HALF-OPEN for Ollama Embeddings - testing recovery`,
          );
          break;
      }
    });
  }

  getName(): string {
    return "Ollama";
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      this.logger.log(`Embedding ${texts.length} documents with Ollama`);

      const embeddings: number[][] = [];

      // Batches run in sequence, not in parallel. Ollama serves one model on
      // one GPU and shares it with the nightly LLM cron; overlapping requests
      // queue there instead of here, where nothing can see them.
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        embeddings.push(...(await this.embedBatch(batch, DOCUMENT_PREFIX)));
      }

      return embeddings;
    } catch (error) {
      this.logger.error("Ollama embedding failed:", error);
      throw new EmbeddingError(this.getName(), error as Error);
    }
  }

  async embedQuery(query: string): Promise<number[]> {
    try {
      this.logger.log("Embedding query with Ollama");
      const [embedding] = await this.embedBatch([query], QUERY_PREFIX);
      return embedding;
    } catch (error) {
      this.logger.error("Ollama query embedding failed:", error);
      throw new EmbeddingError(this.getName(), error as Error);
    }
  }

  /**
   * One `/api/embed` call for the whole batch.
   *
   * This replaces a loop over the legacy `/api/embeddings` endpoint, which
   * takes a single `prompt` and so cost one HTTP round trip and one model
   * invocation per text. Measured against real Ollama on 64 corpus-shaped
   * texts, model pre-warmed so neither side pays `load_duration`:
   *
   *   batched   672ms / 721ms
   *   per-call  3393ms / 3428ms      → **~5x**
   *
   * (Roadmap §1.2 recorded 739ms vs 4671ms, i.e. 6.3x. The batched figure
   * reproduces; the per-call side came out faster on this run, so the honest
   * claim is ~5x, not 6x. The direction and the order of magnitude are what
   * the decision rests on.)
   *
   * Every backfill and re-embed pays that difference, and the M2 chunking work
   * multiplies the call count, so the batched path is a precondition for
   * "re-embedding is routine" rather than an optimisation.
   */
  private async embedBatch(
    texts: string[],
    prefix: string,
  ): Promise<number[][]> {
    const input = this.taskPrefixes ? texts.map((t) => prefix + t) : texts;

    // Wrap the call with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as { embeddings?: number[][] };
      const embeddings = data.embeddings;

      // Ollama returns embeddings positionally, and the caller zips them back
      // onto rows by index. A short or malformed response would therefore
      // write one row's vector onto another row — wrong, and undetectable
      // afterwards. Checked here rather than trusted.
      if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
        throw new Error(
          `Expected ${input.length} embeddings, got ${
            Array.isArray(embeddings) ? embeddings.length : "none"
          }`,
        );
      }

      return embeddings;
    });
  }

  /**
   * Refuse to start when the configured model is not on the daemon.
   *
   * Without this, a stack deployed before `ollama pull` runs starts clean and
   * reports healthy: the width assertion passes, because MODEL_DIMENSIONS says
   * 768 and the columns are 768 — nothing there knows whether the weights
   * exist. The failure lands per row at embed time as `HTTP 404: model "X" not
   * found`, and the only trace is `failed=N` in a sync summary. Rehearsed
   * against a real daemon (#1156): it fails safe — existing vectors are
   * untouched — but quietly, which is the half worth fixing.
   *
   * ── Missing model vs unreachable daemon ──────────────────────────────────
   *
   * Only the first is fatal. A model that was never pulled is a deploy mistake
   * that will never fix itself, so booting is pointless. A daemon that does not
   * answer may be restarting, and the circuit breaker already handles that at
   * runtime; refusing to boot would turn a thirty-second blip into a crash
   * loop. So an unreachable daemon warns and continues.
   *
   * (The same distinction the pre-push hook draws between "the audit found
   * something" and "the audit could not run" — conflating them is what teaches
   * people to bypass the gate.)
   */
  async assertReady(): Promise<void> {
    let installed: string[];

    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { models?: { name?: string }[] };
      installed = (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === "string");
    } catch (error) {
      // Not fatal — see above.
      this.logger.warn(
        `Could not reach Ollama at ${this.baseUrl} to verify model ` +
          `"${this.model}" (${(error as Error).message}). Starting anyway: an ` +
          `unreachable daemon may be restarting, and the circuit breaker covers ` +
          `it. If embeddings then fail with a 404, the model was never pulled.`,
      );
      return;
    }

    // Ollama treats a bare name as `:latest`, so `nomic-embed-text-v2-moe` and
    // `nomic-embed-text-v2-moe:latest` are the same model. Comparing raw
    // strings would reject a correctly-pulled model over a tag spelling.
    const want = withDefaultTag(this.model);
    if (installed.some((name) => withDefaultTag(name) === want)) {
      this.logger.log(`Ollama model "${this.model}" is available`);
      return;
    }

    throw new Error(
      `Ollama model "${this.model}" is not installed on ${this.baseUrl}. ` +
        `Pull it before starting this service:\n\n    ollama pull ${this.model.split(":")[0]}\n\n` +
        `Installed: ${installed.length > 0 ? installed.join(", ") : "(none)"}.`,
    );
  }

  /**
   * Get circuit breaker health status
   */
  getCircuitBreakerHealth(): CircuitBreakerHealth {
    return this.circuitBreaker.getHealth();
  }
}
