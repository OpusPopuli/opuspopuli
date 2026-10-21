import {
  ILLMProvider,
  LlmMetric,
  LlmPhase,
  LlmTokenDirection,
  PipelineStage,
  withStage,
  type ChatMessage,
  type GenerateOptions,
  type GenerateResult,
  type MetricsObserver,
} from "@opuspopuli/common";

/** Which lane a provider belongs to, used as the `lane` label. */
export type LlmLane = "analysis" | "ingestion";

/**
 * Wrap a provider so every call reports its phase timings and token counts
 * (M2, `docs/plans/ingestion-resource-lanes.md` §2).
 *
 * Wrapping at the lane factory rather than at each call site is deliberate:
 * `LlmGeneratorBase` is not the only caller — RAG and rerank hold a provider
 * too — and a metric that covers some callers is worse than none, because the
 * totals look complete. Here, every consumer of
 * `LLM_ANALYSIS_PROVIDER`/`LLM_INGESTION_PROVIDER` is measured by
 * construction.
 *
 * Registers nothing. The observer is the seam described on
 * {@link MetricsObserver}; this file never touches prom-client, so it cannot
 * register a metric on a registry nobody serves.
 *
 * Emits only what the provider reported. A build that returns no phase
 * durations produces no phase observations — not zeros, which would read as
 * "the GPU did this instantly" and drag every average down.
 *
 * @param provider - The provider to wrap
 * @param lane - Lane label
 * @param observer - Where to send observations; absent means no measurement
 * @returns The provider, instrumented, or unchanged when no observer is bound
 */
export function withLaneMetrics(
  provider: ILLMProvider,
  lane: LlmLane,
  observer?: MetricsObserver,
): ILLMProvider {
  if (!observer) return provider;

  const record = (result: GenerateResult): void => {
    const labels = { lane, model: provider.getModelName() };

    // `undefined` means the field was absent; 0 is a real measurement —
    // a zero load is how you know the model was already resident.
    const phases: [string, number | undefined][] = [
      [LlmPhase.Load, result.phases?.loadSeconds],
      [LlmPhase.Prefill, result.phases?.prefillSeconds],
      [LlmPhase.Decode, result.phases?.decodeSeconds],
    ];
    for (const [phase, seconds] of phases) {
      if (seconds === undefined) continue;
      observer.observe(LlmMetric.RequestDurationSeconds, seconds, {
        ...labels,
        phase,
      });
    }

    const tokens: [string, number | undefined][] = [
      [LlmTokenDirection.In, result.tokensIn],
      [LlmTokenDirection.Out, result.tokensOut],
    ];
    for (const [direction, count] of tokens) {
      if (count === undefined) continue;
      observer.increment(LlmMetric.TokensTotal, count, {
        ...labels,
        direction,
      });
    }
  };

  // Every member of ILLMProvider, named explicitly. NOT `{ ...provider }`:
  // the methods are prototype members, so a spread copies none of them —
  // the first version of this file spread and then listed five of seven,
  // leaving `generateStream` and `isAvailable` undefined at runtime while
  // tsc stayed happy, because the spread is TYPED as a complete provider.
  // Written out, a new member is a missing-property compile error.
  /**
   * Also count the call as time spent in the `llm` STAGE (M1).
   *
   * Not a duplicate of the phase timings above, and the difference is the
   * point. Ollama's `load`/`prefill`/`decode` are what the GPU did; this is
   * the caller's wall clock, so it also contains the HTTP round trip and any
   * time the request sat behind `OLLAMA_NUM_PARALLEL`. Subtracting one from
   * the other is how §3 row 2 shows queue wait, and a sync whose stages do
   * not sum to its duration is a sync with time nobody has accounted for.
   *
   * Here rather than in each generator for the same reason as the phase
   * metrics: every consumer of a lane provider is covered by construction.
   * No item is counted — one LLM call is not one item, and several generators
   * make more than one call per row.
   */
  const measured = <T>(fn: () => Promise<T>): Promise<T> =>
    withStage(PipelineStage.Llm, { lane, model: provider.getModelName() }, fn, {
      observer,
    });

  return {
    generate: async (
      prompt: string,
      options?: GenerateOptions,
    ): Promise<GenerateResult> =>
      measured(async () => {
        const result = await provider.generate(prompt, options);
        record(result);
        return result;
      }),
    chat: async (
      messages: ChatMessage[],
      options?: GenerateOptions,
    ): Promise<GenerateResult> =>
      measured(async () => {
        const result = await provider.chat(messages, options);
        record(result);
        return result;
      }),
    // Delegated unmeasured. A stream yields tokens and never returns a
    // GenerateResult, so Ollama's phase durations — which arrive in the
    // final non-streaming payload — are not available on this path. Counting
    // it as a zero-duration request would understate every average.
    generateStream: (prompt: string, options?: GenerateOptions) =>
      provider.generateStream(prompt, options),
    getName: () => provider.getName(),
    getModelName: () => provider.getModelName(),
    getModelDigest: () => provider.getModelDigest(),
    isAvailable: () => provider.isAvailable(),
  };
}
