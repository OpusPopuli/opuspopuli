import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stableHash, type DataSourceConfig } from "@opuspopuli/common";
import {
  BULK_MAPPING_VERSION,
  bulkImportKey,
} from "../src/handlers/bulk-import-key";

/**
 * The files that decide what a bulk export line becomes: the line parser, the
 * domain mapper, and the helpers between them (`mapBatchItems`,
 * `inferSourceSystem`, which stamps `sourceSystem`). Whole files, so a
 * reformat trips it too: a false bump costs one full rewrite, and a missed one
 * leaves skipped rows stale with nothing to show it.
 *
 * The download and unzip code is deliberately not pinned. A change there that
 * alters a line's text alters its hash, so the row is rewritten anyway.
 */
const PINNED_FILES = [
  "src/handlers/bulk-line-parser.ts",
  "src/handlers/handler-utils.ts",
  "src/mapping/domain-mapper.service.ts",
];

/**
 * One entry per mapping version, newest last. When this spec fails, the
 * mapping code changed: add an entry with a NEW version, set
 * `BULK_MAPPING_VERSION` to it, and paste the hashes the failure prints.
 * Never edit an old entry; its version must keep meaning what it meant.
 * One exception: a version that has never left dev may be re-pinned in place
 * when every table whose written shape changed also has a changed source
 * config (so a new import key) or has had its rows deleted. bm1 was re-pinned
 * for F8 on that basis: only S496 and CVR2 changed, their config changed with
 * regions#98, and the migration deleted their old rows
 * (`docs/plans/campaign-finance-phase-b.md`, "F8 built").
 */
const PINS: { version: string; files: Record<string, string> }[] = [
  {
    version: "bm1",
    files: {
      "src/handlers/bulk-line-parser.ts":
        "ee4be5221719924f820e7441478cc2efb3fdc89c046eb40dc5e932ca8ed9b57f",
      "src/handlers/handler-utils.ts":
        "fa3e04b485108e6412010fe09f36e8407b3be11556950ffcdd4f3ea5d48d4aec",
      "src/mapping/domain-mapper.service.ts":
        "65d8a003ba03eb3e3b974a68517e2fd8f0efe8d3245e85c1ff861e8fd359ca1e",
    },
  },
];

function hashOf(file: string): string {
  const text = readFileSync(join(__dirname, "..", file), "utf8");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("bulkImportKey (campaign-finance-phase-b.md, D2)", () => {
  const source = {
    url: "https://example.test/export.zip",
    dataType: "campaign_finance",
    sourceType: "bulk_download",
    category: "CAL-ACCESS Contributions",
    bulk: { format: "csv", columnMappings: { CMTE_ID: "committeeId" } },
  } as unknown as DataSourceConfig;

  it("is the same for the same source", () => {
    expect(bulkImportKey({ ...source })).toBe(bulkImportKey(source));
  });

  it("changes when the source's mapping changes", () => {
    const changed = {
      ...source,
      bulk: { format: "csv", columnMappings: { CMTE_ID: "payeeName" } },
    } as unknown as DataSourceConfig;

    expect(bulkImportKey(changed)).not.toBe(bulkImportKey(source));
  });

  it("covers the mapping version, so a bump changes every key", () => {
    expect(bulkImportKey(source)).toBe(
      stableHash({
        mapping: BULK_MAPPING_VERSION,
        dataType: source.dataType,
        category: source.category,
        bulk: source.bulk,
      }),
    );
  });
});

describe("BULK_MAPPING_VERSION (campaign-finance-phase-b.md, D2)", () => {
  const latest = PINS[PINS.length - 1];

  it("is the newest pinned version", () => {
    expect(BULK_MAPPING_VERSION).toBe(latest.version);
  });

  it("is bumped whenever the mapping code changes", () => {
    const current = Object.fromEntries(PINNED_FILES.map((f) => [f, hashOf(f)]));

    // A failure here means: bump BULK_MAPPING_VERSION and add a pin. Rows the
    // next sync skips as unchanged would otherwise keep what the OLD code made
    // of their line.
    expect(current).toEqual(latest.files);
  });

  it("never reuses a version", () => {
    const versions = PINS.map((p) => p.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
