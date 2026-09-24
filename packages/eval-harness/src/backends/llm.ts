/**
 * The generation backend — production's LLM provider, driven as production
 * drives it.
 *
 * This is the R4 seam. `LlmGeneratorBase`, JSON mode and per-generator Zod
 * schemas are all planned to change under the provenance work (epic #1207), so
 * everything the harness depends on is confined to this one file: it consumes
 * `ILLMProvider.generate()` and nothing else. When the provider interface
 * moves, this is the file that moves with it.
 *
 * The settings below are not defaults chosen here — they mirror
 * `proposition-analysis.service.ts` exactly, because a harness configured
 * differently from production measures a system nobody runs. #1142's first run
 * is the cautionary case: it used 2000 tokens where production uses 6000, left
 * reasoning on where production sends `think: false`, and produced entirely
 * invalid results from configuration alone.
 */

import {
  OllamaLLMProvider,
  resolveContextTokens,
  contextTokensWarning,
} from "@opuspopuli/llm-provider";
import { setGlobalHttpPool } from "@opuspopuli/common";

/**
 * Raise undici's headers timeout before any fetch fires.
 *
 * `ILLMProvider.generate()` posts with `stream: false`, so Ollama sends no
 * response headers until the whole generation is finished. undici's default
 * `headersTimeout` is 300s and is NOT governed by the provider's
 * `requestTimeoutMs` — so a generation that takes longer than five minutes
 * dies as `TypeError: fetch failed` / `UND_ERR_HEADERS_TIMEOUT` however
 * generous the configured timeout is.
 *
 * Measured here, not theorised: on 2026-09-16 both think runs died this way —
 * qwen3.5:9b at 302s on its first measure, olmo-3:7b-think on its third — and
 * a reasoning model is exactly the case that exceeds five minutes.
 *
 * `region`, `region-worker` and `llm-rerank-worker` each do this at boot for
 * the same reason; the value mirrors theirs. `knowledge`, `documents` and
 * `structural-analysis-worker` do NOT, which is filed separately — the harness
 * matching production's *configured* services is the right default here,
 * because measuring the unfixed path would measure the bug rather than
 * the model.
 */
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

/** Mirrors PROPOSITION_ANALYSIS_MAX_TOKENS. NOT 2000 — see #1085. */
export const ANALYSIS_MAX_TOKENS = 6000;
/** Mirrors the temperature proposition-analysis.service.ts passes. */
export const ANALYSIS_TEMPERATURE = 0.2;

/**
 * Reasoning models need a bigger budget, not the same one.
 *
 * `think: false` is what production sends and is the default here. But a
 * reasoning checkpoint asked to think will spend the budget thinking before it
 * answers: qwen3.5:9b returned an EMPTY response having spent all 2000 tokens
 * on hidden reasoning, and gpt-oss:20b produced 22,000-26,000 characters of
 * reasoning and no answer at default effort. When thinking is deliberately
 * enabled, the answer must not be starved — hence the multiplier rather than a
 * shared constant.
 */
export const THINKING_BUDGET_MULTIPLIER = 3;

export interface GenerationRun {
  text: string;
  finishReason?: string;
  tokensIn?: number;
  tokensOut?: number;
  maxTokens: number;
  ms: number;
  /** Output tokens per second — the throughput number R7 needs. */
  tokensPerSecond?: number;
}

export interface LlmBackend {
  model: string;
  think: boolean;
  maxTokens: number;
  generate(prompt: string): Promise<GenerationRun>;
}

export interface LlmBackendOptions {
  model: string;
  /**
   * Set EXPLICITLY per model — never left to a default. #1142 lists this
   * first among the things not to skip.
   */
  think?: boolean;
  maxTokens?: number;
  url?: string;
  /**
   * Analysis on a long measure runs for minutes, and a 32B dense model runs
   * for considerably longer. The provider's 60s default would time out and
   * read as a model failure.
   */
  requestTimeoutMs?: number;
  /**
   * Context window in tokens, as a string so it is validated by the same rule
   * as the deployment setting — `"128k"` is rejected, not parsed as 128.
   * Defaults to LLM_ANALYSIS_CONTEXT_TOKENS / LLM_CONTEXT_TOKENS.
   */
  contextTokens?: string;
}

export function createLlmBackend(opts: LlmBackendOptions): LlmBackend {
  const think = opts.think ?? false;
  const maxTokens =
    opts.maxTokens ??
    (think
      ? ANALYSIS_MAX_TOKENS * THINKING_BUDGET_MULTIPLIER
      : ANALYSIS_MAX_TOKENS);

  // Context window, from the same env vars and the same validator the services
  // use. Without this passthrough every eval behind this seam — generation,
  // throughput, symmetry, adversarial — would measure a model that may have
  // read 15% of each document, while production read all of it. A harness that
  // differs from production in the one dimension production just got a setting
  // for is measuring the wrong thing.
  const { contextTokens, warning } = resolveContextTokens(
    opts.contextTokens ??
      process.env.LLM_ANALYSIS_CONTEXT_TOKENS ??
      process.env.LLM_CONTEXT_TOKENS,
  );
  if (warning) console.warn(contextTokensWarning(warning));

  const provider = new OllamaLLMProvider({
    url: opts.url ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: opts.model,
    requestTimeoutMs: opts.requestTimeoutMs ?? 30 * 60 * 1000,
    ...(contextTokens ? { contextTokens } : {}),
  });

  return {
    model: opts.model,
    think,
    maxTokens,
    async generate(prompt: string): Promise<GenerationRun> {
      const started = Date.now();
      const result = await provider.generate(prompt, {
        maxTokens,
        temperature: ANALYSIS_TEMPERATURE,
        think,
      });
      const ms = Date.now() - started;

      return {
        text: result.text ?? "",
        finishReason: result.finishReason,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        maxTokens,
        ms,
        tokensPerSecond:
          result.tokensOut && ms > 0
            ? Number(((result.tokensOut / ms) * 1000).toFixed(2))
            : undefined,
      };
    },
  };
}
