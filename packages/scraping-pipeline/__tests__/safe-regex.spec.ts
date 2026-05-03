import { preparePattern, safeRegex } from "../src/extraction/safe-regex";

/**
 * Flag order is implementation-defined (we use Set iteration order +
 * default-flag spread), so tests assert on a sorted form rather than a
 * specific permutation. Explicit comparator satisfies Sonar S2871.
 */
const sortFlags = (flags: string): string =>
  [...flags].sort((a, b) => a.localeCompare(b)).join("");

describe("preparePattern", () => {
  it("leaves a pattern with no inline flags untouched", () => {
    expect(preparePattern("^foo$")).toEqual({
      pattern: "^foo$",
      flags: "",
      normalized: false,
      droppedFlags: [],
    });
  });

  it("preserves the caller's default flags when no inline group is present", () => {
    expect(preparePattern("^foo$", "g")).toEqual({
      pattern: "^foo$",
      flags: "g",
      normalized: false,
      droppedFlags: [],
    });
  });

  it("strips a single Python-style multiline inline flag (the SCA 1 case)", () => {
    expect(preparePattern("(?m)^COMMITTEE HEARINGS")).toEqual({
      pattern: "^COMMITTEE HEARINGS",
      flags: "m",
      normalized: true,
      droppedFlags: [],
    });
  });

  it("merges inline flags with caller-supplied default flags", () => {
    // splitIntoBlocks calls with default 'gm'; an LLM emitting (?i) on top
    // should yield gmi (or some permutation).
    const result = preparePattern(String.raw`(?i)\n{2,}`, "gm");
    expect(result.pattern).toBe(String.raw`\n{2,}`);
    expect(sortFlags(result.flags)).toBe("gim");
    expect(result.normalized).toBe(true);
  });

  it("handles compound inline flags like (?ims)", () => {
    const result = preparePattern("(?ims)abc");
    expect(result.pattern).toBe("abc");
    expect(sortFlags(result.flags)).toBe("ims");
  });

  it("strips STACKED inline flag groups (the actual senate-daily-file case)", () => {
    // The LLM produces `(?s)(?m)^COMMITTEE HEARINGS` — two leading groups,
    // not one compound (?ms). A single-pass strip leaves the inner (?m)
    // behind and JS rejects it. Loop must continue until no prefix remains.
    const result = preparePattern("(?s)(?m)^COMMITTEE HEARINGS");
    expect(result.pattern).toBe("^COMMITTEE HEARINGS");
    expect(sortFlags(result.flags)).toBe("ms");
    expect(result.normalized).toBe(true);
  });

  it("strips three or more stacked groups", () => {
    const result = preparePattern("(?i)(?m)(?s)foo");
    expect(result.pattern).toBe("foo");
    expect(sortFlags(result.flags)).toBe("ims");
  });

  it("stops stripping at the first non-flag-group token", () => {
    // (?:abc) is a non-capturing group, not an inline-flag group — must
    // not be eaten even though it follows an inline flag.
    const result = preparePattern("(?m)(?:abc)def");
    expect(result.pattern).toBe("(?:abc)def");
    expect(result.flags).toBe("m");
  });

  it("drops unsupported inline flags but keeps supported ones", () => {
    // 'x' (extended) is Python-only, not supported by JS — should be dropped
    const result = preparePattern("(?mx)abc");
    expect(result.pattern).toBe("abc");
    expect(result.flags).toBe("m");
    expect(result.droppedFlags).toContain("x");
  });

  it("drops the entire negative-flag group safely", () => {
    const result = preparePattern("(?-m)abc", "g");
    expect(result.pattern).toBe("abc");
    expect(result.flags).toBe("g");
    expect(result.droppedFlags).toContain("-m");
  });

  it("does not mistake non-flag groups for inline flags", () => {
    // (?:...) is a non-capturing group, (?=...) is lookahead — these are
    // valid JS regex syntax and must not be touched
    expect(preparePattern("(?:foo)bar").pattern).toBe("(?:foo)bar");
    expect(preparePattern("(?=foo)bar").pattern).toBe("(?=foo)bar");
    expect(preparePattern("(?<name>foo)").pattern).toBe("(?<name>foo)");
  });
});

describe("safeRegex", () => {
  it("compiles a valid pattern into a RegExp", () => {
    const regex = safeRegex("^foo$");
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex?.test("foo")).toBe(true);
  });

  it("compiles the SCA 1 (?m) case after normalization", () => {
    // Without normalization, this would throw "Invalid group" — that was
    // the failure mode that wiped out the senate meetings sync.
    const regex = safeRegex("(?m)^COMMITTEE HEARINGS");
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex?.flags).toContain("m");
    expect(regex?.test("Some preamble\nCOMMITTEE HEARINGS\nrest")).toBe(true);
  });

  it("returns undefined and invokes onError for an actually-broken pattern", () => {
    const onError = jest.fn();
    const regex = safeRegex("(unclosed", "", onError);
    expect(regex).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        pattern: "(unclosed",
      }),
    );
  });

  it("returns undefined for empty pattern", () => {
    expect(safeRegex("")).toBeUndefined();
  });

  it("merges default flags with normalized inline flags", () => {
    const regex = safeRegex("(?i)foo", "g");
    expect(sortFlags(regex?.flags ?? "")).toBe("gi");
  });
});
