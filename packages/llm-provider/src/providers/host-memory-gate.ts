/**
 * Don't load a model the host has no room for
 * (`docs/plans/gpu-lane-host-memory-gate.md`, #1434).
 *
 * Ollama decides whether a model fits from the Metal budget, not from what
 * the rest of the host is using. On Apple silicon those are the same bytes,
 * so it loads 23.7 GiB of weights, unswappable once loaded, into a host with
 * no memory or swap left. On 2026-11-07 that froze the dev Mac three or four
 * times. This asks first, but only when a call would LOAD a model: a model
 * that is already resident costs nothing more.
 *
 * The workers run in Docker and cannot see host memory, so the numbers come
 * from a probe on the host (`scripts/host-memory-probe/`). Once configured,
 * the gate fails closed: a probe that doesn't answer counts as no room
 * (owner decision, §5 Q2). An unconfigured gate is off, and returns no gate.
 */

import { Logger } from "@nestjs/common";
import {
  HostMemoryMetric,
  LLMError,
  type MetricsObserver,
} from "@opuspopuli/common";

export type HostGateOutcome = "admitted" | "deferred" | "probe_unreachable";

export interface HostMemoryGate {
  /** Whether a call to `model` on the Ollama at `url` may go ahead now. */
  check(url: string, model: string): Promise<HostGateDecision>;
  /**
   * The call `check` let through failed. Free its reservation now, rather
   * than holding other models back for the rest of it.
   */
  release(url: string, model: string): void;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HostMemoryGateConfig {
  /** The host probe's `/memory` endpoint. */
  probeUrl: string;
  /** What must remain free after the model loads. */
  headroomBytes: number;
  fetchFn?: FetchFn;
  /** Per request; the probe and Ollama's listings are local and fast. */
  timeoutMs?: number;
  /**
   * Ollama's `OLLAMA_MAX_LOADED_MODELS`: at this many resident, a load evicts
   * one. Default 1, as every node and the dev Mac run it.
   */
  maxLoadedModels?: number;
  /** Told every outcome, with what it was decided from. */
  onOutcome?: (outcome: HostGateOutcome, detail: HostGateDetail) => void;
  /** The clock, for tests. */
  now?: () => number;
}

export interface HostGateDetail {
  model: string;
  /** Unset when the model was resident, or the probe did not answer. */
  neededBytes?: number;
  /**
   * What the host can give: the probe's free memory, plus what an eviction
   * releases, minus loads this process let through that have not landed.
   */
  reclaimableBytes?: number;
}

export interface HostGateDecision extends HostGateDetail {
  outcome: HostGateOutcome;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const GIB = 1024 ** 3;

/**
 * The error a gated call throws when there is no room: an LLMError, so every
 * existing handler still catches it, recognisable so the GPU lane can wait
 * rather than fail.
 */
export class HostMemoryUnavailableError extends LLMError {
  constructor(
    provider: string,
    operation: string,
    readonly outcome: Exclude<HostGateOutcome, "admitted">,
    detail: HostGateDetail,
  ) {
    super(provider, operation, new Error(describe(outcome, detail)));
    this.name = "HostMemoryUnavailableError";
  }
}

export function isHostMemoryUnavailable(
  error: unknown,
): error is HostMemoryUnavailableError {
  return error instanceof HostMemoryUnavailableError;
}

function describe(outcome: HostGateOutcome, d: HostGateDetail): string {
  if (outcome === "probe_unreachable") {
    return `not loading ${d.model}: the host memory probe did not answer`;
  }
  return (
    `not loading ${d.model}: the host has ${gib(d.reclaimableBytes)} GiB ` +
    `reclaimable and it needs ${gib(d.neededBytes)} GiB`
  );
}

const gib = (bytes?: number): string =>
  bytes === undefined ? "?" : (bytes / GIB).toFixed(1);

export function createHostMemoryGate(
  config: HostMemoryGateConfig,
): HostMemoryGate {
  const fetchFn: FetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLoaded = config.maxLoadedModels ?? 1;
  const now = config.now ?? Date.now;
  /** Model sizes by `url|model`: a tag's weights change only on a pull. */
  const sizes = new Map<string, number>();
  /**
   * Loads this process let through that Ollama does not list as resident
   * yet. Without them, two calls for different models moments apart would
   * each be measured against the same free memory and both load: the freeze
   * this gate exists to stop. Only this process's own loads; another
   * container's can still race (plan §3).
   */
  const pending = new Map<
    string,
    { bytes: number; until: number; landedAt?: number }
  >();

  const getJson = async (url: string): Promise<unknown> => {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const decide = (
    outcome: HostGateOutcome,
    detail: HostGateDetail,
  ): HostGateDecision => {
    config.onOutcome?.(outcome, detail);
    return { outcome, ...detail };
  };

  /**
   * Bytes reserved by other loads still in flight. A landed load keeps its
   * reservation a little longer: the probe's reading can be a second old and
   * taken before the weights were committed, and would otherwise show the
   * memory they now hold as free (final review of #1434).
   */
  const reservedFor = (
    key: string,
    url: string,
    resident: ReadonlySet<string>,
  ): number => {
    const prefix = `${url}|`;
    const t = now();
    let bytes = 0;
    for (const [k, r] of pending) {
      // Another endpoint's loads are judged against its own listing.
      if (!k.startsWith(prefix)) continue;
      if (resident.has(k.slice(prefix.length))) r.landedAt ??= t;
      const settled =
        r.landedAt !== undefined && t - r.landedAt > LANDED_GRACE_MS;
      if (settled || r.until <= t) pending.delete(k);
      else if (k !== key) bytes += r.bytes;
    }
    return bytes;
  };

  return {
    async check(url, rawModel) {
      const model = canonicalModel(rawModel);
      const key = `${url}|${model}`;
      // What Ollama can't answer is not this gate's to decide: the call
      // itself then fails as unreachable, which every caller already handles.
      const resident = await residentModels(getJson, url).catch(
        () => undefined,
      );
      if (!resident || resident.names.has(model)) {
        return decide("admitted", { model });
      }

      const size = await modelSize(getJson, sizes, url, model).catch(
        () => undefined,
      );
      if (size === undefined) return decide("admitted", { model });

      const neededBytes = size + config.headroomBytes;
      const free = await probe(getJson, config.probeUrl).catch(() => undefined);
      if (free === undefined) {
        return decide("probe_unreachable", { model, neededBytes });
      }
      const reclaimableBytes =
        free +
        evictableBytes(resident, maxLoaded) -
        reservedFor(key, url, resident.names);
      if (reclaimableBytes < neededBytes) {
        return decide("deferred", { model, neededBytes, reclaimableBytes });
      }
      pending.set(key, { bytes: size, until: now() + RESERVATION_MS });
      return decide("admitted", { model, neededBytes, reclaimableBytes });
    },
    release(url, rawModel) {
      pending.delete(`${url}|${canonicalModel(rawModel)}`);
    },
  };
}

/** How long a let-through load holds its reservation if it never shows. */
const RESERVATION_MS = 120_000;
/**
 * How long a landed load stays reserved: past the probe's 1 s cache and one
 * request timeout, so no reading from before the load is still in use.
 */
const LANDED_GRACE_MS = 5_000;

/**
 * Ollama's name for a model: `mistral` is listed as `mistral:latest`, and an
 * exact match on the bare name would never find it, which silently admits
 * every call (review of #1434).
 */
export function canonicalModel(model: string): string {
  // `library/x` is the default namespace, and Ollama lists it as plain `x`.
  const name = model.startsWith("library/") ? model.slice(8) : model;
  const lastSegment = name.slice(name.lastIndexOf("/") + 1);
  return lastSegment.includes(":") ? name : `${name}:latest`;
}

interface OllamaModelList {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    size_vram?: number;
  }>;
}

interface Resident {
  names: Set<string>;
  /**
   * The memory each loaded model holds, one entry per model. `size` first:
   * on unified memory a model held by the CPU (`size_vram` 0) still holds
   * host memory, and it still counts towards Ollama's model limit.
   */
  bytes: number[];
}

async function residentModels(
  getJson: (url: string) => Promise<unknown>,
  url: string,
): Promise<Resident> {
  const body = (await getJson(`${url}/api/ps`)) as OllamaModelList;
  const resident: Resident = { names: new Set(), bytes: [] };
  for (const m of body.models ?? []) {
    if (typeof m.name === "string") resident.names.add(canonicalModel(m.name));
    if (typeof m.model === "string") {
      resident.names.add(canonicalModel(m.model));
    }
    const held = m.size ?? m.size_vram;
    resident.bytes.push(typeof held === "number" && held > 0 ? held : 0);
  }
  return resident;
}

/**
 * Memory Ollama frees by unloading to make room. With `maxLoaded` models
 * already loaded it must evict one first (`OLLAMA_MAX_LOADED_MODELS`, 1 on
 * every node), so a swap from one model to another is not refused for want
 * of the very memory it releases. It evicts the least recently used, which
 * this can't see, so it counts the smallest.
 */
function evictableBytes(resident: Resident, maxLoaded: number): number {
  if (resident.bytes.length === 0 || resident.bytes.length < maxLoaded) {
    return 0;
  }
  return Math.min(...resident.bytes);
}

async function modelSize(
  getJson: (url: string) => Promise<unknown>,
  cache: Map<string, number>,
  url: string,
  model: string,
): Promise<number | undefined> {
  const key = `${url}|${model}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const body = (await getJson(`${url}/api/tags`)) as OllamaModelList;
  const size = body.models?.find(
    (m) =>
      (typeof m.name === "string" && canonicalModel(m.name) === model) ||
      (typeof m.model === "string" && canonicalModel(m.model) === model),
  )?.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return undefined;
  }
  cache.set(key, size);
  return size;
}

async function probe(
  getJson: (url: string) => Promise<unknown>,
  probeUrl: string,
): Promise<number | undefined> {
  const body = (await getJson(probeUrl)) as { reclaimableBytes?: unknown };
  const bytes = body.reclaimableBytes;
  // A malformed answer is no answer: fail closed, like silence.
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0
    ? bytes
    : undefined;
}

/** `LLM_HOST_HEADROOM_GB` when it is a usable number; otherwise the default. */
export const DEFAULT_HEADROOM_GB = 4;

export function headroomBytesFrom(value: string | undefined): number {
  const gb = Number(value);
  return (
    (value && Number.isFinite(gb) && gb >= 0 ? gb : DEFAULT_HEADROOM_GB) * GIB
  );
}

/**
 * The process's gate, built once from the environment and shared by every
 * provider: the lane providers `buildLane` makes and the ones a GPU-lane
 * consumer makes (`createLaneProvider`). Null when `LLM_HOST_MEMORY_URL` is
 * unset, which turns the gate off. The Studio runs that way until the probe is
 * ported there; the boot log says so.
 *
 * The probe describes ONE host: the one Ollama runs on. A deployment that
 * splits its lanes across hosts needs one probe per host, and this will need a
 * per-lane URL (plan §3).
 */
let shared: HostMemoryGate | null | undefined;
let sharedObserver: MetricsObserver | undefined;
const logger = new Logger("HostMemoryGate");
/** At most one "no room" warning per model per this interval. */
const WARN_INTERVAL_MS = 60_000;

export function sharedHostMemoryGate(
  observer?: MetricsObserver,
): HostMemoryGate | null {
  sharedObserver ??= observer;
  if (shared !== undefined) return shared;

  const probeUrl = process.env.LLM_HOST_MEMORY_URL?.trim();
  if (!probeUrl) {
    logger.log(
      "Host memory gate OFF (LLM_HOST_MEMORY_URL unset): a model will be " +
        "loaded whatever the host has free",
    );
    shared = null;
    return shared;
  }

  const headroomBytes = headroomBytesFrom(process.env.LLM_HOST_HEADROOM_GB);
  const maxLoaded = Number(process.env.LLM_HOST_MAX_LOADED_MODELS);
  const lastWarned = new Map<string, number>();
  shared = createHostMemoryGate({
    probeUrl,
    headroomBytes,
    maxLoadedModels: maxLoadedFor(maxLoaded),
    onOutcome: (outcome, detail) => {
      sharedObserver?.increment(HostMemoryMetric.GateTotal, 1, {
        model: detail.model,
        outcome,
      });
      if (outcome === "admitted") return;
      const now = Date.now();
      if (now - (lastWarned.get(detail.model) ?? 0) < WARN_INTERVAL_MS) return;
      lastWarned.set(detail.model, now);
      logger.warn(
        outcome === "probe_unreachable"
          ? `${describe(outcome, detail)} at ${probeUrl}; nothing will load ` +
              "until it does"
          : describe(outcome, detail),
      );
    },
  });
  logger.log(
    `Host memory gate ON: probe ${probeUrl}, headroom ${gib(headroomBytes)} ` +
      `GiB, assuming Ollama keeps at most ${maxLoadedFor(maxLoaded)} model(s) ` +
      "loaded (LLM_HOST_MAX_LOADED_MODELS; must match OLLAMA_MAX_LOADED_MODELS)",
  );
  return shared;
}

/** `LLM_HOST_MAX_LOADED_MODELS` when it is a positive integer; else 1. */
function maxLoadedFor(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** Tests only: forget the shared gate so the next call re-reads the env. */
export function resetSharedHostMemoryGate(): void {
  shared = undefined;
  sharedObserver = undefined;
}
