import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLocalDatabase,
  regressions,
  scoreRep,
  type RepRow,
} from "./representatives-eval.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gold = JSON.parse(
  readFileSync(join(ROOT, "fixtures/gold-representatives.json"), "utf8"),
) as {
  pages: (Parameters<typeof scoreRep>[0] & { extractedTextForAudit: string })[];
};

const row = (over: Partial<RepRow> = {}): RepRow => ({
  name: "x",
  bio: null,
  bioSource: null,
  bioClaims: null,
  committeesSummary: null,
  bioPromptHash: null,
  bioLlmDigest: null,
  committeesSummaryPromptHash: null,
  committeesSummaryLlmDigest: null,
  ...over,
});

describe("scoreRep", () => {
  /**
   * The matcher's own check, against real data: every gold item is quoted
   * from the page's audit text, so a candidate that IS that text must score
   * full recall. A matcher that cannot find gold in its own source would
   * report every model as missing what it got right.
   */
  test("the page's own text scores full committee recall on every gold page", () => {
    for (const page of gold.pages) {
      // One committee per line, as the page lists them, so a match within a
      // line is a match on that committee.
      const text = page.extractedTextForAudit;
      const score = scoreRep(page, row({ committeesSummary: text, bio: text }));
      for (const [field, r] of Object.entries(score.committees ?? {})) {
        assert.equal(
          r.found,
          r.total,
          `${page.rep} / ${field}: missed ${r.missed.join("; ")}`,
        );
      }
      assert.equal(
        score.counties?.found,
        score.counties?.total,
        `${page.rep} / counties: missed ${score.counties?.missed.join("; ")}`,
      );
    }
  });

  test("an empty summary where gold has committees is a dropout, not a 0", () => {
    const score = scoreRep(gold.pages[0], row({ committeesSummary: "" }));

    assert.ok(score.emptied.includes("committeesSummary"));
  });

  test("a rep with no row is reported missing, not scored", () => {
    const score = scoreRep(gold.pages[0], null);

    assert.equal(score.found, false);
    assert.equal(score.committees, undefined);
  });

  test("labelling is not exercised until the bio has a source page (#1381)", () => {
    const score = scoreRep(
      gold.pages[0],
      row({ bioClaims: [{ origin: "source", sentence: "anything" }] }),
    );

    assert.equal(score.labelling?.exercised, false);
  });
});

describe("regressions", () => {
  const page = gold.pages[0];
  const full = scoreRep(
    page,
    row({
      committeesSummary: page.extractedTextForAudit,
      bio: page.extractedTextForAudit,
    }),
  );

  test("none when the candidate is the baseline", () => {
    assert.deepEqual(regressions([full], [full]), []);
  });

  test("a committee found before and missed now is a regression", () => {
    const worse = scoreRep(page, row({ committeesSummary: "Budget." }));

    assert.ok(regressions([worse], [full]).length > 0);
  });

  test("a gain elsewhere does not pay for a loss", () => {
    const other = { ...full, rep: "Someone Else" };
    const worse = scoreRep(page, row({ committeesSummary: "" }));

    assert.ok(
      regressions([worse, other], [full, { ...other, committees: {} }]).length >
        0,
    );
  });
});

describe("regressions — each kind", () => {
  const page = gold.pages[0];
  const full = scoreRep(
    page,
    row({
      committeesSummary: page.extractedTextForAudit,
      bio: page.extractedTextForAudit,
    }),
  );

  test("a rep no longer found", () => {
    assert.deepEqual(regressions([], [full]), [`${page.rep}: no longer found`]);
  });

  test("a role kept before and lost now", () => {
    const role = Object.values(full.committees ?? {})
      .flatMap((r) => r.roles)
      .find((r) => r.kept);
    assert.ok(role, "the first gold page states a non-Member role");
    // Every committee still named, the role word gone.
    const flattened = page.extractedTextForAudit.replace(
      new RegExp(role.role, "gi"),
      "Member",
    );
    const after = scoreRep(
      page,
      row({ committeesSummary: flattened, bio: page.extractedTextForAudit }),
    );

    assert.ok(
      regressions([after], [full]).some((r) =>
        r.endsWith(`${role.role} of ${role.committee}: lost`),
      ),
    );
  });

  test("fewer counties", () => {
    const after = scoreRep(
      page,
      row({ committeesSummary: page.extractedTextForAudit, bio: "" }),
    );

    assert.ok(
      regressions([after], [full]).some((r) => r.includes("/ counties:")),
    );
  });
});

describe("the recorded baseline", () => {
  const baseline = JSON.parse(
    readFileSync(
      join(ROOT, "fixtures/representatives-eval-baseline.json"),
      "utf8",
    ),
  ) as { reps: Parameters<typeof regressions>[1] };

  test("scores every tuning page — a rep it lacks would never be gated", () => {
    assert.deepEqual(
      baseline.reps.map((r) => r.rep).sort(),
      gold.pages.map((p) => p.rep).sort(),
    );
    assert.ok(baseline.reps.every((r) => r.found));
  });
});

describe("assertLocalDatabase", () => {
  test("accepts this machine", () => {
    assertLocalDatabase("postgresql://u:p@localhost:5432/postgres", false);
    assertLocalDatabase("postgresql://u:p@127.0.0.1:5432/postgres", false);
  });

  test("refuses another host unless told to", () => {
    assert.throws(
      () => assertLocalDatabase("postgresql://u:p@db.example.org/x", false),
      /not this machine/,
    );
    assertLocalDatabase("postgresql://u:p@db.example.org/x", true);
  });

  test("refuses an unset URL", () => {
    assert.throws(() => assertLocalDatabase(undefined, true), /not set/);
  });
});
