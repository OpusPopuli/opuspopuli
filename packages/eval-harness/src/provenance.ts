/**
 * Model provenance — what actually answered, recorded per result.
 *
 * R3 requires comparisons at **matched quantization**, and the reason is not
 * pedantry: Ollama serves q4 by default, so an OLMo-q4 against qwen-q4 is
 * partly a comparison of two quantizations rather than two models. The client
 * cannot tell you any of this — `OllamaLLMProvider.getModelName()` returns
 * `this.config.model`, the bare tag, and a tag is not a pin. `qwen3.5:9b` can
 * be re-pulled and mean different bytes tomorrow.
 *
 * So a recorded score should name the digest, the quantization, the
 * architecture and the runtime version. #1149's caches otherwise blend
 * outputs that were never comparable, and a model-selection decision (R7/M7)
 * rests on numbers nobody can reproduce.
 *
 * Two pieces of metadata here earn their place beyond bookkeeping:
 *
 *   - **`capabilities`**, which reports `thinking` for reasoning-capable
 *     checkpoints. #1142's first run was invalidated by leaving reasoning on
 *     by accident; `assertThinkDecided` turns that from a silent 0/3 into a
 *     refusal to start.
 *   - **`quantization`**, which comes back `unknown` for some community GGUF
 *     builds. That is itself the signal the OCR work recorded — a broken
 *     vision GGUF is indistinguishable from a working one by metadata alone.
 */

/**
 * Runtimes a run can be recorded against.
 *
 * `probeModel` only speaks Ollama's API, so that is the only one produced
 * automatically. `mlx` exists because the throughput comparison was run under
 * it and a result that cannot name its runtime is not provenance — the union
 * is what lets such a run be recorded without lying about where it came from.
 * `assertComparable` already refuses to compare across runtimes.
 */
export type RuntimeName = "ollama" | "mlx";

export interface RuntimeInfo {
  name: RuntimeName;
  version: string;
  url: string;
}

export interface ModelProvenance {
  /** The tag as requested, e.g. `qwen3.5:9b`. Not a pin. */
  model: string;
  /** Content digest — this IS the pin. Truncated to 16 hex chars. */
  digest: string;
  /** e.g. `Q4_K_M`, `F16`. `unknown` on some community GGUF builds. */
  quantization: string;
  architecture: string;
  /** Exact count from `general.parameter_count`, when the build reports it. */
  parameterCount?: number;
  /** Human label from the manifest, e.g. `9.7B`. */
  parameterSize: string;
  /** e.g. `completion`, `vision`, `tools`, `thinking`. */
  capabilities: string[];
  runtime: RuntimeInfo;
}

const DEFAULT_URL = "http://localhost:11434";

interface ShowResponse {
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}

interface TagsResponse {
  models?: Array<{ name: string; digest?: string }>;
}

/** Shape the `/api/show` + `/api/tags` + `/api/version` responses into one record. */
export function buildProvenance(
  model: string,
  show: ShowResponse,
  digest: string | undefined,
  version: string,
  url: string,
): ModelProvenance {
  const info = show.model_info ?? {};
  const parameterCount = info["general.parameter_count"];

  return {
    model,
    // A missing digest is recorded as `unknown`, never silently omitted: the
    // absence is itself something a reader of the result should see.
    digest: digest ? digest.replace(/^sha256[:-]/, "").slice(0, 16) : "unknown",
    quantization: show.details?.quantization_level ?? "unknown",
    architecture:
      (typeof info["general.architecture"] === "string"
        ? (info["general.architecture"] as string)
        : undefined) ??
      show.details?.family ??
      "unknown",
    parameterCount:
      typeof parameterCount === "number" ? parameterCount : undefined,
    parameterSize: show.details?.parameter_size ?? "unknown",
    capabilities: show.capabilities ?? [],
    runtime: { name: "ollama", version, url },
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function probeModel(
  model: string,
  url: string = process.env.OLLAMA_URL ?? DEFAULT_URL,
): Promise<ModelProvenance> {
  const base = url.replace(/\/$/, "");

  const [show, tags, version] = await Promise.all([
    getJson<ShowResponse>(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }),
    // The digest lives on the manifest listing, not on /api/show.
    getJson<TagsResponse>(`${base}/api/tags`).catch(() => ({}) as TagsResponse),
    getJson<{ version?: string }>(`${base}/api/version`)
      .then((v) => v.version ?? "unknown")
      .catch(() => "unknown"),
  ]);

  const digest = tags.models?.find((m) => m.name === model)?.digest;
  return buildProvenance(model, show, digest, version, base);
}

/** `qwen3.5:9b@Q4_K_M/ollama-0.18.0` — stable, and readable in a filename. */
export function describeProvenance(p: ModelProvenance): string {
  return `${p.model}@${p.quantization}/${p.runtime.name}-${p.runtime.version}`;
}

export function slugFor(p: ModelProvenance): string {
  return `${p.model}-${p.quantization}`.replace(/[^a-z0-9]+/gi, "-");
}

/**
 * Refuse to compare runs that differ in anything but the model.
 *
 * The whole point of recording quantization is that a q4-vs-q8 result is not a
 * model comparison. Having recorded it, the harness should act on it rather
 * than leave the reader to notice.
 */
export function assertComparable(a: ModelProvenance, b: ModelProvenance): void {
  const problems: string[] = [];
  if (a.quantization !== b.quantization) {
    problems.push(
      `quantization differs (${a.quantization} vs ${b.quantization}) — ` +
        "this would be partly a quantization comparison, not a model comparison",
    );
  }
  if (a.runtime.name !== b.runtime.name) {
    problems.push(`runtime differs (${a.runtime.name} vs ${b.runtime.name})`);
  }
  if (a.runtime.version !== b.runtime.version) {
    problems.push(
      `runtime version differs (${a.runtime.version} vs ${b.runtime.version})`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to compare ${describeProvenance(a)} with ${describeProvenance(b)}:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}

/**
 * A reasoning-capable model must have its `think` setting decided explicitly.
 *
 * This is #1142's first "do not skip" requirement, enforced instead of
 * documented. Left to a default, qwen3.5:9b spent an entire 2000-token budget
 * on hidden reasoning and returned an EMPTY response — scoring 0/3 on JSON
 * while production generated the same analyses fine. `gpt-oss:20b` did the
 * same at default effort. That reads as model incompatibility and is one flag.
 */
export function assertThinkDecided(
  p: ModelProvenance,
  thinkWasExplicit: boolean,
): void {
  if (!p.capabilities.includes("thinking") || thinkWasExplicit) return;

  throw new Error(
    `${p.model} reports the "thinking" capability, and no explicit think ` +
      "setting was given.\n\n" +
      "Left to a default, a reasoning model can spend its whole token budget " +
      "on hidden reasoning and return an empty response — which scores as a " +
      "format failure and reads as model incompatibility. Pass --think (with " +
      "a larger budget) or --no-think to state the decision.\n",
  );
}
