import { extractJsonObjectSlice, stripCodeFences } from "@opuspopuli/common";

describe("stripCodeFences", () => {
  it("strips ```json fence + closing ```", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips bare ``` fence", () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves plain JSON untouched", () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("does not strip a fence that's not at the start", () => {
    // Defensive — only strips at start of input
    expect(stripCodeFences('{"a":1}\n```')).toBe('{"a":1}\n```');
  });
});

describe("extractJsonObjectSlice", () => {
  it("returns the slice of a clean JSON object", () => {
    expect(extractJsonObjectSlice('{"a":1}')).toBe('{"a":1}');
  });

  it("recovers JSON from prose-prefixed LLM output", () => {
    const text = 'Here are the rules: {"a":1,"b":[2,3]} hope this helps!';
    expect(extractJsonObjectSlice(text)).toBe('{"a":1,"b":[2,3]}');
  });

  it("recovers JSON from inside markdown code fences", () => {
    const text = '```json\n{"a":1,"b":2}\n```';
    expect(extractJsonObjectSlice(text)).toBe('{"a":1,"b":2}');
  });

  it("handles braces inside string values correctly", () => {
    const text = '{"pattern":"^{HEARING}","group":1}';
    expect(extractJsonObjectSlice(text)).toBe(text);
  });

  it("handles escaped quotes inside string values", () => {
    const text = '{"q":"she said \\"hi\\"","n":1}';
    expect(extractJsonObjectSlice(text)).toBe(text);
  });

  it("handles nested objects", () => {
    const text = '{"outer":{"inner":{"deep":1}},"sibling":2}';
    expect(extractJsonObjectSlice(text)).toBe(text);
  });

  it("returns undefined when no `{` present", () => {
    expect(extractJsonObjectSlice("just prose, no JSON here")).toBeUndefined();
  });

  it("returns undefined for unbalanced braces (truncated LLM output)", () => {
    // The real failure mode: LLM truncated mid-string at token limit.
    // The first `{` opens but never balances — salvage returns undefined.
    expect(
      extractJsonObjectSlice('{"itemDelimiter":"\\n\\n","fieldMappings":[{"fi'),
    ).toBeUndefined();
  });

  it("returns just the first balanced object when prose follows", () => {
    const text = '{"a":1} extra notes after { partial broken';
    expect(extractJsonObjectSlice(text)).toBe('{"a":1}');
  });
});
