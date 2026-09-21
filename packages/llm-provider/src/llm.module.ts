import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ILLMProvider, setGlobalHttpPool } from "@opuspopuli/common";
import { llmConfig } from "@opuspopuli/config-provider";
import {
  OllamaLLMProvider,
  OllamaConfig,
} from "./providers/ollama.provider.js";

/**
 * LLM Module
 *
 * Configures Dependency Injection for language model providers.
 *
 * Provider: Ollama (self-hosted, OSS, full privacy)
 *
 * Supports any Ollama model:
 * - qwen3.5:9b (default dev, 9B, 256K context, Apache 2.0)
 * - qwen3.5:35b (default prod, 35B, 256K context, Apache 2.0)
 * - mistral (7B, instruction following and JSON output)
 * - Or any other model from ollama.com/library
 *
 * Setup:
 * 1. Install Ollama: https://ollama.com
 * 2. Pull model: ollama pull qwen3.5:9b
 * 3. Start server: ollama serve
 */
const logger = new Logger("LLMModule");

/**
 * Floor for undici's `headersTimeout` in any service that talks to an LLM.
 *
 * `OllamaLLMProvider.generate()` posts with `stream: false`, so Ollama sends
 * NO response headers until the whole generation has finished. undici's
 * default `headersTimeout` is 300s and is governed by neither the provider's
 * `requestTimeoutMs` nor an `AbortSignal` — so any generation over five
 * minutes dies as `UND_ERR_HEADERS_TIMEOUT`, naming neither the timeout nor
 * the model, which reads as "Ollama is down" rather than "this was slow".
 *
 * Measured (#1142 eval sweep, 2026-09-16): `qwen3.5:9b --think` died at
 * exactly 302s three times out of three. It is not only a reasoning-model
 * problem — two NON-think measures in the same sweep took 1086s and 1150s
 * under memory pressure and would have failed identically. The 32B at
 * ~550s/measure sits well past the default.
 */
const LLM_HEADERS_TIMEOUT_FLOOR_MS = 1_350_000;

/**
 * Raise the transport timeout wherever an LLM provider is built.
 *
 * Three services set this in their own `main.ts` and three did not (#1273) —
 * `knowledge`, `documents` and `structural-analysis-worker`, which are the
 * ones running citizen-facing analysis. Copying the line a fourth, fifth and
 * sixth time fixes today and leaves the same trap for service number seven,
 * so it goes where every LLM consumer passes instead.
 *
 * Safe to call here: nothing else creates the shared pool, so in a service
 * without a `main.ts` call this is the first and wins, and in one with it the
 * entrypoint already ran with the same value.
 */
function ensureLlmTransportTimeout(requestTimeoutMs: number): void {
  // Never below the floor: `requestTimeoutMs` defaults to 60s, and deriving
  // the headers timeout from it alone would cut the transport to BELOW
  // undici's own 300s default and make this worse than doing nothing.
  const headersTimeoutMs = Math.max(
    requestTimeoutMs,
    LLM_HEADERS_TIMEOUT_FLOOR_MS,
  );
  setGlobalHttpPool({ headersTimeoutMs });
}

/** Which inference lane a provider serves (roadmap §6.4). */
type Lane = "analysis" | "ingestion";

/**
 * Build one lane's provider.
 *
 * Shared rather than duplicated per lane: two near-identical factories drift,
 * and the way they drift is that one lane quietly stops honouring a timeout
 * the other does — which nothing would catch, because both still construct.
 * (It is also a CPD-gate clone.)
 *
 * @param configService - Resolved configuration
 * @param lane - Which lane to build
 * @returns An Ollama provider pinned to that lane's model and endpoint
 */
function buildLane(configService: ConfigService, lane: Lane): ILLMProvider {
  const requestTimeoutMs = Number.parseInt(
    configService.get<string>("OLLAMA_REQUEST_TIMEOUT_MS") ?? "",
    10,
  );
  const chunkTimeoutMs = Number.parseInt(
    configService.get<string>("OLLAMA_CHUNK_TIMEOUT_MS") ?? "",
    10,
  );

  // The ingestion lane falls back to the analysis values at every level, so
  // an unconfigured deployment gets the provider it had before the split.
  const prefix = lane === "ingestion" ? "llm.ingestion" : "llm.ollama";
  const url =
    configService.get<string>(`${prefix}.url`) ||
    configService.get<string>("llm.ollama.url") ||
    configService.get<string>("llm.url") ||
    "http://localhost:11434";
  const model =
    configService.get<string>(`${prefix}.model`) ||
    configService.get<string>("llm.ollama.model") ||
    configService.get<string>("llm.model") ||
    "mistral";

  const ollamaConfig: OllamaConfig = {
    url,
    model,
    ...(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? { requestTimeoutMs }
      : {}),
    ...(Number.isFinite(chunkTimeoutMs) && chunkTimeoutMs > 0
      ? { chunkTimeoutMs }
      : {}),
  };

  // Headers timeout before any generation fires. Derived from the configured
  // request timeout so a deployment that raises one raises the other — the
  // per-call override in ollama.provider.ts notes civics-glossary "needs 20+
  // min where bio gen needs 2", and above five minutes that override is inert
  // without this.
  ensureLlmTransportTimeout(
    Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : 0,
  );

  // Said out loud at boot. Which model each lane resolved to is the first
  // thing anyone asks when output looks wrong, and inferring it from four
  // environment variables and a fallback chain is how a service ends up
  // running a model nobody chose.
  logger.log(`LLM ${lane} lane: ${model} at ${url}`);

  if (lane === "ingestion") {
    const hasModel = Boolean(process.env.LLM_INGESTION_MODEL);
    const hasUrl = Boolean(process.env.LLM_INGESTION_URL);
    if (hasUrl && !hasModel) {
      // The footgun this warns about: pointing ingestion at a second host
      // without naming its model sends the ANALYSIS model there — a 32B at
      // ~21.4GB aimed at a machine chosen for a 7B, which fails as a pull
      // error or an out-of-memory rather than as a misconfiguration.
      logger.warn(
        "LLM_INGESTION_URL is set but LLM_INGESTION_MODEL is not, so the " +
          `ingestion lane will run the analysis model (${model}) on ` +
          `${url}. Set LLM_INGESTION_MODEL, or unset the URL to share one host.`,
      );
    }
  }

  return new OllamaLLMProvider(ollamaConfig);
}

@Module({
  imports: [ConfigModule.forFeature(llmConfig)],
  providers: [
    {
      provide: "LLM_ANALYSIS_PROVIDER",
      useFactory: (configService: ConfigService): ILLMProvider =>
        buildLane(configService, "analysis"),
      inject: [ConfigService],
    },
    /**
     * The ingestion lane (roadmap §6.4).
     *
     * Structural analysis, civics extraction, detail crawling and PDF
     * extraction are throughput-bound and run across far more documents than
     * analysis does, and what they need is reliable JSON rather than verbatim
     * fidelity. Measured, the small model is as good at that job and ~10x
     * cheaper — so pinning them together spends the large model's wall clock
     * where it buys nothing.
     *
     * A separate token rather than a parameter, because the choice belongs to
     * the deployment rather than the call site: a service should not pick a
     * model per request, and a reader should be able to tell which lane a
     * service is on from its constructor.
     */
    {
      provide: "LLM_INGESTION_PROVIDER",
      useFactory: (configService: ConfigService): ILLMProvider =>
        buildLane(configService, "ingestion"),
      inject: [ConfigService],
    },
  ],
  exports: ["LLM_ANALYSIS_PROVIDER", "LLM_INGESTION_PROVIDER"],
})
export class LLMModule {}
