import { buildSkipKey, laneJobId, stableHash } from "../src/utils/skip-key";

/**
 * §4 shared rule: the key changes whenever ANY input that can change the
 * output changes. Each "change one input" case below is the test the plan's
 * verification asks every skip fix to run.
 */
describe("buildSkipKey", () => {
  const base = {
    sourceHash: "src-1",
    promptHash: "prompt-1",
    modelDigest: "sha256:aaa",
    configHash: "cfg-1",
  };

  it("is stable for the same inputs", () => {
    expect(buildSkipKey(base)).toBe(buildSkipKey({ ...base }));
    expect(buildSkipKey(base)).toMatch(/^sk1-[0-9a-f]{64}$/);
  });

  it.each([
    ["source", { sourceHash: "src-2" }],
    ["prompt", { promptHash: "prompt-2" }],
    ["model digest", { modelDigest: "sha256:bbb" }],
    ["config", { configHash: "cfg-2" }],
    ["config removed", { configHash: null }],
  ])("changes when the %s changes", (_name, change) => {
    expect(buildSkipKey({ ...base, ...change })).not.toBe(buildSkipKey(base));
  });

  it("cannot be fooled by moving characters between fields", () => {
    expect(
      buildSkipKey({ ...base, sourceHash: "ab", promptHash: "c" }),
    ).not.toBe(buildSkipKey({ ...base, sourceHash: "a", promptHash: "bc" }));
  });

  it("cannot be fooled by a value that contains a delimiter", () => {
    // Collided under the first, joined-string version of the key.
    expect(
      buildSkipKey({ ...base, sourceHash: "x|prompt=y", promptHash: "z" }),
    ).not.toBe(
      buildSkipKey({ ...base, sourceHash: "x", promptHash: "y|prompt=z" }),
    );
  });

  it("keeps no config distinct from a config hashed to the string none", () => {
    expect(buildSkipKey({ ...base, configHash: null })).not.toBe(
      buildSkipKey({ ...base, configHash: "none" }),
    );
  });

  it("ignores whitespace around the digest", () => {
    expect(buildSkipKey({ ...base, modelDigest: " sha256:aaa " })).toBe(
      buildSkipKey(base),
    );
  });

  it.each([["unknown"], [""], ["  "]])(
    "refuses to key an unresolved model digest (%p)",
    (modelDigest) => {
      // Two runs on different weights that both failed to resolve would
      // otherwise share a key, and the second would be skipped.
      expect(buildSkipKey({ ...base, modelDigest })).toBeNull();
    },
  );

  it("refuses a whitespace-only input, and treats a missing one as unresolved", () => {
    expect(buildSkipKey({ ...base, sourceHash: "   " })).toBeNull();
    expect(buildSkipKey({ ...base, promptHash: "\t" })).toBeNull();
    // An untyped caller: returns null ("always run"), never throws.
    expect(
      buildSkipKey({ ...base, modelDigest: undefined as unknown as string }),
    ).toBeNull();
  });

  it("refuses to key an empty source or prompt hash", () => {
    expect(buildSkipKey({ ...base, sourceHash: "" })).toBeNull();
    expect(buildSkipKey({ ...base, promptHash: "" })).toBeNull();
    expect(buildSkipKey({ ...base, configHash: "" })).toBeNull();
  });
});

describe("stableHash", () => {
  it("ignores key order at every depth", () => {
    expect(stableHash({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } })).toBe(
      stableHash({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }),
    );
  });

  it("keeps array order — it is meaningful in config", () => {
    expect(stableHash({ a: [1, 2] })).not.toBe(stableHash({ a: [2, 1] }));
  });

  it("treats an undefined member as absent", () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it.each([
    ["a Date", { at: new Date() }],
    ["a Map", { m: new Map([["k", 1]]) }],
    ["a Set", { s: new Set([1]) }],
  ])("throws on %s rather than hashing it as {}", (_name, value) => {
    // Flattened to {}, a change inside it would never change the hash.
    expect(() => stableHash(value)).toThrow(TypeError);
  });

  it("hashes a __proto__ key from parsed JSON by its content", () => {
    // Assigned onto a plain {}, the key called the prototype setter and
    // vanished, so both of these hashed as {}.
    expect(stableHash(JSON.parse('{"__proto__":{"x":1}}'))).not.toBe(
      stableHash(JSON.parse('{"__proto__":{"x":2}}')),
    );
  });

  it("says plainly when there is nothing to hash", () => {
    expect(() => stableHash(undefined)).toThrow(/not JSON-serialisable/);
  });

  it("accepts an object with no prototype", () => {
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(stableHash(bare)).toBe(stableHash({ a: 1 }));
  });
});

describe("laneJobId", () => {
  it("joins with a separator BullMQ accepts", () => {
    expect(laneJobId("bill-123", "extract", "sk1-abc")).toBe(
      "bill-123__extract__sk1-abc",
    );
  });

  it.each([
    ["a colon", "bill:123"],
    ["the separator", "bill__123"],
    ["nothing", ""],
    ["a trailing underscore", "bill_"],
    ["a leading underscore", "_bill"],
  ])("refuses a part containing %s", (_name, entity) => {
    expect(() => laneJobId(entity, "extract", "sk1-abc")).toThrow();
  });

  it("allows single internal underscores", () => {
    expect(laneJobId("bill-1", "stage_backfill", "sk1-a")).toBe(
      "bill-1__stage_backfill__sk1-a",
    );
  });

  it("cannot merge an underscore into the separator", () => {
    // `a_` + `b` and `a` + `_b` both joined to `a___b`; the second enqueue
    // would have been dropped as a duplicate.
    expect(() => laneJobId("a_", "b", "k")).toThrow();
    expect(() => laneJobId("a", "_b", "k")).toThrow();
  });
});
