import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assertSafeExternalIds } from "./build-fulltext-fixture.js";

describe("assertSafeExternalIds", () => {
  test("accepts the shapes the corpus actually uses", () => {
    assert.doesNotThrow(() =>
      assertSafeExternalIds(["25-0002A1", "ACA 22", "SB 1.2"]),
    );
  });

  test("rejects a quote before it reaches the query", () => {
    // --symmetry reads ids from a JSON fixture rather than the const above,
    // so the ids are no longer guaranteed to be hand-written.
    assert.throws(
      () => assertSafeExternalIds(["25-0002A1", "x' or '1'='1"]),
      /malformed external id/,
    );
  });

  test("rejects a semicolon and names the offender", () => {
    assert.throws(
      () => assertSafeExternalIds(["ACA 22; drop table propositions"]),
      /drop table/,
    );
  });

  test("rejects an empty id", () => {
    assert.throws(() => assertSafeExternalIds([""]), /malformed external id/);
  });
});
