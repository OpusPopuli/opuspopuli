/**
 * Route a lane's batch generations through its endpoint's lane queue (S7,
 * `docs/plans/S7-gpu-lane-queue.md`).
 *
 * Applied in `buildLane`, so every consumer of a lane provider is covered by
 * construction — the same reason `withLaneMetrics` lives there, OUTSIDE this
 * wrapper: the `llm` stage a sync records is then the wait for the GPU plus
 * the inference, which is what the sync actually spent, and
 * `lane_wait_seconds` breaks out the queue's share. When no
 * dispatcher is bound (an API process, or `GPU_LANE_QUEUE_ENABLED` off) the
 * provider is returned untouched: interactive inference stays direct.
 */

import type {
  ChatMessage,
  GenerateOptions,
  ILLMProvider,
  IGpuLaneDispatcher,
  GpuLaneEndpoint,
} from "@opuspopuli/common";
import type { GpuLane } from "./lane-metrics.js";
import { OllamaLLMProvider } from "./ollama.provider.js";

export function withLaneQueue(
  provider: ILLMProvider,
  dispatcher: IGpuLaneDispatcher | null | undefined,
  lane: GpuLane,
  endpoint: GpuLaneEndpoint,
): ILLMProvider {
  if (!dispatcher) return provider;
  dispatcher.register(lane, endpoint);
  return {
    // The one call batch work makes, queued for a consumer to run.
    generate: (prompt: string, options?: GenerateOptions) =>
      dispatcher.generate({ lane, endpoint, prompt, options }),
    // No production caller uses these; they pass through rather than grow a
    // second job shape nothing exercises.
    chat: (messages: ChatMessage[], options?: GenerateOptions) =>
      provider.chat(messages, options),
    generateStream: (prompt: string, options?: GenerateOptions) =>
      provider.generateStream(prompt, options),
    getName: () => provider.getName(),
    getModelName: () => provider.getModelName(),
    getModelDigest: () => provider.getModelDigest(),
    isAvailable: () => provider.isAvailable(),
  };
}

/**
 * The provider a consumer runs a lane job on: the endpoint as this process
 * registered it. Unmeasured — the producer measures, around the whole wait.
 *
 * Its circuit breaker sees every process's jobs on this endpoint, so it opens
 * for all of them together when Ollama is failing. That is the intent: one
 * GPU, one health signal, and a waiter fails fast instead of queueing behind
 * calls that cannot succeed.
 */
export function createLaneProvider(endpoint: GpuLaneEndpoint): ILLMProvider {
  return new OllamaLLMProvider({ ...endpoint });
}
