/**
 * Build `fixtures/fulltext-propositions.json` from the dev database.
 *
 * This is a script rather than a documented psql one-liner for one reason:
 * redaction must not be optional. `propositions.full_text` carries proponent
 * contact details (see `redaction.ts`), and a copy-pasteable SQL command is a
 * command someone will eventually run without the redaction step. Here it is a
 * post-condition — the write is refused if anything survives.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/eval-harness fixtures:fulltext
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { redactContactDetails, findContactDetails } from "@opuspopuli/common";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The measures the generation eval runs on.
 *
 * Chosen to span three axes that the scorers need:
 *
 *   - **Size.** 2,799-13,541 characters. The five smallest reproduce the range
 *     #1142's published run used (2,799-4,477), so those numbers stay
 *     comparable; the larger ones exercise the 6,000-token output budget that
 *     #1085 raised from 2,000.
 *   - **Figures present or absent.** Grounding needs measures that contain
 *     dollar amounts AND measures that contain none — the granite fabrication
 *     happened on a measure whose text has no `$` at all.
 *   - **Fiscal analysis absent.** Verified by reading: none of these carries a
 *     fiscal analysis. The "fiscal" strings that do appear are a filing
 *     checklist item, "without regard to fiscal years" boilerplate, a "fiscal
 *     emergency" condition in operative text, and "Fiscal committee: no"
 *     routing metadata. That makes an empty `fiscalImpact` the correct answer
 *     on all of them, which is the abstention case.
 *
 * `25-0012A2` was considered and REJECTED: its `full_text` is the AG
 * transmittal cover letter, not the measure — enclosure list, proponent block
 * and a purpose paragraph. That is a corpus defect worth fixing upstream (R2),
 * not an analysis fixture.
 */
const MEASURES = [
  "25-0002A1",
  "25-0003",
  "25-0007A1",
  "25-0015",
  "25-0017",
  "25-0019A1",
  "25-0037A1",
  "25-0038A1",
  "25-0041A1",
  "ACA 22",
];

/**
 * What an `external_id` is allowed to look like before it is spliced into SQL.
 *
 * The ids come from a committed fixture or the const above, so this is not a
 * trust boundary today — but `--symmetry` reads them from a JSON file, and a
 * quote in one would break the query rather than be rejected. Validating is
 * cheaper than establishing the habit of interpolating whatever a file says.
 */
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9 .-]*$/;

export function assertSafeExternalIds(ids: string[]): void {
  const bad = ids.filter((id) => !EXTERNAL_ID.test(id));
  if (bad.length > 0) {
    throw new Error(
      `Refusing to build a query from ${bad.length} malformed external id(s): ` +
        `${bad.map((b) => JSON.stringify(b)).join(", ")}. Expected letters, ` +
        "digits, spaces, dots and hyphens.",
    );
  }
}

interface Row {
  externalId: string;
  title: string;
  fullText: string;
}

/** Measures referenced by `fixtures/symmetry-pairs.json`, both sides of every pair. */
function symmetryMeasures(): string[] {
  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/symmetry-pairs.json"), "utf8"),
  ) as {
    pairs: Array<{ a: { externalId: string }; b: { externalId: string } }>;
  };
  return [
    ...new Set(fixture.pairs.flatMap((p) => [p.a.externalId, p.b.externalId])),
  ];
}

async function main(): Promise<void> {
  // One builder, two fixtures. Redaction is a post-condition on both: a second
  // bespoke query is a second place for someone to skip it.
  const symmetry = process.argv.includes("--symmetry");
  const measures = symmetry ? symmetryMeasures() : MEASURES;
  const outFile = symmetry
    ? "fixtures/symmetry-sources.json"
    : "fixtures/fulltext-propositions.json";

  assertSafeExternalIds(measures);

  const sql = `
select json_agg(j order by j->>'externalId') from (
  select json_build_object(
    'externalId', external_id,
    'title', title,
    'fullText', full_text) as j
  from propositions
  where external_id in (${measures.map((m) => `'${m}'`).join(", ")})
    and full_text is not null) s`;

  const { stdout } = await run("docker", [
    "exec",
    process.env.OPUSPOPULI_DB_CONTAINER ?? "opuspopuli-db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-t",
    "-A",
    "-c",
    sql,
  ]);

  const rows = JSON.parse(stdout) as Row[];
  if (rows.length !== measures.length) {
    const got = new Set(rows.map((r) => r.externalId));
    throw new Error(
      `Expected ${measures.length} measures, got ${rows.length}. Missing: ` +
        measures.filter((m) => !got.has(m)).join(", "),
    );
  }

  let redactions = 0;
  const items = rows.map((r) => {
    const { text, hits } = redactContactDetails(r.fullText);
    if (hits.length) {
      console.log(
        `${r.externalId}: redacted ${hits.map((h) => h.kind).join(", ")}`,
      );
    }
    redactions += hits.length;
    return {
      externalId: r.externalId,
      title: r.title,
      fullText: text,
      chars: text.length,
      redactions: hits.length,
    };
  });

  // Post-condition. A redaction pattern that stops matching must fail the
  // build, not quietly ship personal data into git history.
  const residue = items.flatMap((i) => findContactDetails(i.fullText));
  if (residue.length > 0) {
    throw new Error(
      `Refusing to write: ${residue.length} contact detail(s) survived ` +
        `redaction (${[...new Set(residue.map((r) => r.kind))].join(", ")}).`,
    );
  }

  const fixture = {
    schemaVersion: 1,
    kind: symmetry ? "symmetry-source" : "generation-source",
    corpus: "propositions",
    note:
      "title + fullText as production sends them to the analysis prompt, with " +
      "proponent contact details redacted (src/redaction.ts). Production sends " +
      "this text UNREDACTED — that is a finding about the pipeline, not " +
      "something this fixture fixes. Rebuild with: pnpm --filter " +
      "@opuspopuli/eval-harness fixtures:fulltext",
    items,
  };

  const out = join(ROOT, outFile);
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(
    `\nwrote ${items.length} measures, ${redactions} redactions, post-condition clean`,
  );
}

// Guarded so the module can be imported by its spec without running a build.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
