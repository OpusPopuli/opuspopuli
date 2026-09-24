import {
  resolveContextTokens,
  contextTokensWarning,
  MIN_CONTEXT_TOKENS,
} from "../src/context-tokens";

/**
 * The cases here are the silent ones. Each was reachable before this parser
 * existed, and each ends the same way: no `num_ctx` on the wire, the GGUF build
 * reading 15% of a bill, and a confident answer about the fragment.
 *
 * Verified by reintroducing the bug: replace the body with
 * `Number.parseInt(raw ?? "", 10)` and the "128k" and "32k" cases fail.
 */
describe("resolveContextTokens", () => {
  it("accepts a plain token count", () => {
    expect(resolveContextTokens("131072")).toEqual({ contextTokens: 131072 });
  });

  it("tolerates surrounding whitespace, which compose interpolation leaves", () => {
    expect(resolveContextTokens(" 131072 ")).toEqual({
      contextTokens: 131072,
    });
  });

  describe("treats absence as 'use the build default', not as an error", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["whitespace only", "   "],
    ])("%s", (_label, input) => {
      expect(resolveContextTokens(input)).toEqual({});
    });
  });

  // parseInt("128k") === 128. A positive finite number that passes every
  // `> 0` guard and makes the model read 128 tokens of a 451 KB bill.
  it.each(["128k", "32k", "131072 tokens", "auto", "1e5", "0x400"])(
    "rejects %s rather than parsing a prefix out of it",
    (input) => {
      const result = resolveContextTokens(input);
      expect(result.contextTokens).toBeUndefined();
      expect(result.warning).toEqual({ value: input, reason: "not-a-number" });
    },
  );

  it.each(["0", "1", "128", "1023"])(
    "rejects %s as below the floor",
    (input) => {
      const result = resolveContextTokens(input);
      expect(result.contextTokens).toBeUndefined();
      expect(result.warning).toEqual({ value: input, reason: "below-minimum" });
    },
  );

  it("accepts exactly the floor", () => {
    expect(resolveContextTokens(String(MIN_CONTEXT_TOKENS))).toEqual({
      contextTokens: MIN_CONTEXT_TOKENS,
    });
  });

  it("rejects a value too large to be an exact integer", () => {
    const result = resolveContextTokens("9".repeat(20));
    expect(result.contextTokens).toBeUndefined();
    expect(result.warning?.reason).toBe("below-minimum");
  });

  it("names the offending value and the consequence in the warning", () => {
    const { warning } = resolveContextTokens("128k");
    const text = contextTokensWarning(warning!);
    expect(text).toContain('"128k"');
    expect(text).toContain("truncates");
    expect(text).toContain("131072");
  });
});
