/**
 * The lane queue contract (S7, `docs/plans/S7-gpu-lane-queue.md`).
 *
 * Batch inference from every worker process goes through one BullMQ queue
 * per Ollama endpoint, bounded globally, so it reaches the GPU one request at
 * a time — and an interactive request (RAG, petition analysis, personalized
 * impact) waits behind at most that one call inside Ollama, never behind the
 * whole backlog, as it did when every process sent straight to an Ollama
 * serving `OLLAMA_NUM_PARALLEL=1` first come, first served.
 *
 * The contract lives here so `llm-provider` can route through a dispatcher
 * without depending on BullMQ; the dispatcher is implemented, and bound, only
 * in the worker processes.
 */

import type { GenerateOptions, GenerateResult } from "./types.js";

/**
 * DI token for the dispatcher. Bound — globally — only in worker processes.
 * An API process never binds it, so its inference stays direct.
 */
export const GPU_LANE_DISPATCHER = "GPU_LANE_DISPATCHER";

/**
 * The endpoint a lane calls. A job names it by `url` + `model`; the consumer
 * runs it only if its OWN process configured that lane the same way, and with
 * its own timeouts (see {@link IGpuLaneDispatcher.register}) — a job is data
 * from Redis, not an instruction to call whatever URL it carries.
 */
export interface GpuLaneEndpoint {
  url: string;
  model: string;
  requestTimeoutMs?: number;
  chunkTimeoutMs?: number;
  contextTokens?: number;
}

export interface GpuLaneJob {
  /** `analysis` or `ingestion` — for metrics, and for the consumer's log. */
  lane: string;
  endpoint: GpuLaneEndpoint;
  prompt: string;
  options?: GenerateOptions;
}

/** Runs one generation through its endpoint's lane queue. */
export interface IGpuLaneDispatcher {
  /**
   * Declare a lane this process configured. Called once per lane when the
   * provider is built; a consumer refuses any job for a lane, url and model
   * it was not told about here.
   */
  register(lane: string, endpoint: GpuLaneEndpoint): void;
  generate(job: GpuLaneJob): Promise<GenerateResult>;
}

/**
 * The lane queue for an Ollama endpoint: `gpu-lane-<host>-<port>`.
 *
 * Per endpoint, not per lane: two lanes on one host share a GPU and so must
 * share a bound; two hosts must not. No `:` — BullMQ rejects it in queue
 * names, which it uses as Redis key segments.
 */
export function laneQueueName(url: string): string {
  let host = "unknown";
  let port = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/\.+$/, "") || host;
    port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    // An unparseable URL fails at the fetch; its jobs share one queue.
  }
  const safe = `${host}-${port}`.replace(/[^a-z0-9.-]/g, "_");
  return `gpu-lane-${safe}`;
}
