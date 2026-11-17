/**
 * Resolve a prompt fingerprint against prompt-service's public attestation
 * record (#1450).
 *
 * Every AI output stores the sha256 of the prompt template that produced it.
 * prompt-service publishes each template as `attestation/templates/<hash>.txt`
 * and maps hashes to names and versions in `attestation/manifest.json`. This
 * reads both from the public repository — never from the running service,
 * whose runtime stays private (#1143).
 */

/** The public repository the prompts are published in. */
export const PROMPT_SERVICE_REPO_URL =
  "https://github.com/OpusPopuli/prompt-service";

const RAW_BASE =
  "https://raw.githubusercontent.com/OpusPopuli/prompt-service/main/attestation";

export const PROMPT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface PromptLabel {
  name: string;
  version: number;
}

export type PromptRecord =
  /** The hash is published, and the fetched text hashes to it. */
  | {
      status: "published";
      hash: string;
      labels: PromptLabel[];
      text: string;
      fileUrl: string;
    }
  /** The record was read, and does not hold this hash. */
  | { status: "unpublished"; hash: string }
  /** Not a sha256 fingerprint at all. */
  | { status: "invalid"; hash: string }
  /**
   * The record could not be read, or its file did not match its own name.
   * Never reported as "unpublished": a network failure is not evidence that
   * a prompt was never published.
   */
  | { status: "unavailable"; hash: string };

interface ManifestEntry {
  hash: string;
  labels: PromptLabel[];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One day: a newly published prompt appears within a day of merging. */
const MANIFEST_REVALIDATE_SECONDS = 86_400;
/** A template file never changes once published; its name is its hash. */
const TEMPLATE_REVALIDATE_SECONDS = 31_536_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function readManifest(fetchImpl: Fetch): Promise<ManifestEntry[]> {
  const response = await fetchImpl(`${RAW_BASE}/manifest.json`, {
    next: { revalidate: MANIFEST_REVALIDATE_SECONDS },
  } as RequestInit);
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  const manifest = (await response.json()) as { entries?: ManifestEntry[] };
  if (!Array.isArray(manifest.entries)) throw new Error("manifest shape");
  return manifest.entries;
}

async function readTemplate(fetchImpl: Fetch, hash: string): Promise<string> {
  const response = await fetchImpl(`${RAW_BASE}/templates/${hash}.txt`, {
    next: { revalidate: TEMPLATE_REVALIDATE_SECONDS },
  } as RequestInit);
  if (!response.ok) throw new Error(`template ${response.status}`);
  return response.text();
}

export async function loadPromptRecord(
  rawHash: string,
  fetchImpl: Fetch = fetch,
): Promise<PromptRecord> {
  const hash = rawHash.toLowerCase();
  if (!PROMPT_HASH_PATTERN.test(hash)) return { status: "invalid", hash };

  try {
    const entry = (await readManifest(fetchImpl)).find((e) => e.hash === hash);
    if (!entry) return { status: "unpublished", hash };

    const text = await readTemplate(fetchImpl, hash);
    // Checked here as a reader would check it: a file that does not hash to
    // its own name is not shown as the prompt.
    if ((await sha256Hex(text)) !== hash)
      return { status: "unavailable", hash };

    return {
      status: "published",
      hash,
      labels: entry.labels ?? [],
      text,
      fileUrl: `${PROMPT_SERVICE_REPO_URL}/blob/main/attestation/templates/${hash}.txt`,
    };
  } catch {
    return { status: "unavailable", hash };
  }
}
