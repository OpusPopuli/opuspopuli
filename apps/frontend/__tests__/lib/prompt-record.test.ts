/**
 * @jest-environment node
 */
import { createHash } from "node:crypto";

import { loadPromptRecord } from "@/lib/prompt-record";

/**
 * Resolving a receipt's prompt fingerprint against prompt-service's public
 * attestation record (#1450). The outcomes must stay apart: a failure to
 * read the record is never reported as "this prompt was never published".
 */

const TEXT = "Analyse {{TEXT}} plainly.\n";
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");

const manifest = (hashes: string[]) =>
  JSON.stringify({
    schemaVersion: 1,
    hashAlgorithm: "sha256",
    grandfatheredLabels: [],
    entries: hashes.map((hash) => ({
      hash,
      bytes: 1,
      labels: [{ name: "document-analysis-proposition-analysis", version: 4 }],
    })),
  });

/** A fetch that serves the given files by URL suffix. */
function serve(files: Record<string, string | number>) {
  return jest.fn(async (url: string) => {
    const key = Object.keys(files).find((suffix) => url.endsWith(suffix));
    const body = key === undefined ? 404 : files[key];
    return typeof body === "number"
      ? new Response("", { status: body })
      : new Response(body, { status: 200 });
  });
}

describe("loadPromptRecord", () => {
  it("returns the published text, checked against its fingerprint", async () => {
    const fetchImpl = serve({
      "manifest.json": manifest([HASH]),
      [`${HASH}.txt`]: TEXT,
    });
    await expect(loadPromptRecord(HASH, fetchImpl)).resolves.toEqual({
      status: "published",
      hash: HASH,
      labels: [{ name: "document-analysis-proposition-analysis", version: 4 }],
      text: TEXT,
      fileUrl: `https://github.com/OpusPopuli/prompt-service/blob/main/attestation/templates/${HASH}.txt`,
    });
  });

  it("reads from the public repository, never the running service", async () => {
    const fetchImpl = serve({
      "manifest.json": manifest([HASH]),
      [`${HASH}.txt`]: TEXT,
    });
    await loadPromptRecord(HASH, fetchImpl);
    for (const [url] of fetchImpl.mock.calls) {
      expect(url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/OpusPopuli\/prompt-service\/main\/attestation\//,
      );
    }
  });

  it("accepts an upper-case fingerprint", async () => {
    const fetchImpl = serve({
      "manifest.json": manifest([HASH]),
      [`${HASH}.txt`]: TEXT,
    });
    const record = await loadPromptRecord(HASH.toUpperCase(), fetchImpl);
    expect(record.status).toBe("published");
  });

  it("says plainly when the record does not hold the fingerprint", async () => {
    const fetchImpl = serve({ "manifest.json": manifest(["ab".repeat(32)]) });
    await expect(loadPromptRecord(HASH, fetchImpl)).resolves.toEqual({
      status: "unpublished",
      hash: HASH,
    });
  });

  it.each(["", "d8cec07f", "z".repeat(64), "../../etc/passwd"])(
    "rejects %p as not a fingerprint, without fetching",
    async (value) => {
      const fetchImpl = serve({});
      const record = await loadPromptRecord(value, fetchImpl);
      expect(record.status).toBe("invalid");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("never shows a file that does not hash to its own name", async () => {
    const fetchImpl = serve({
      "manifest.json": manifest([HASH]),
      [`${HASH}.txt`]: `${TEXT}tampered`,
    });
    const record = await loadPromptRecord(HASH, fetchImpl);
    expect(record.status).toBe("unavailable");
    expect(record).not.toHaveProperty("text");
  });

  it.each([
    ["the manifest is unreachable", { "manifest.json": 503 }],
    ["the manifest is malformed", { "manifest.json": "{ not json" }],
    ["the template is missing", { "manifest.json": manifest([HASH]) }],
  ])(
    "reports 'could not check', never 'unpublished', when %s",
    async (_case, files) => {
      const record = await loadPromptRecord(HASH, serve(files));
      expect(record.status).toBe("unavailable");
    },
  );

  it("reports 'could not check' when the network fails", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const record = await loadPromptRecord(HASH, fetchImpl);
    expect(record.status).toBe("unavailable");
  });
});
