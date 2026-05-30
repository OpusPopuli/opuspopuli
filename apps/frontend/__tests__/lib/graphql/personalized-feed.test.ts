import {
  stripTypename,
  topAxisFor,
  type AxisScores,
} from "@/lib/graphql/personalized-feed";

// stripTypename is shape-agnostic, so the fixture deliberately uses a
// minimal flag-like object rather than enumerating all 20 RankingFlags
// booleans. The full type's shape is enforced by the resolver layer.
const baseFlags = { isRenter: true, isParent: true, isWorker: false } as const;

describe("stripTypename — regression for the __typename bug surfaced in UAT", () => {
  it("removes the __typename field Apollo auto-adds to query responses", () => {
    const withTypename = { ...baseFlags, __typename: "RankingFlags" };
    const cleaned = stripTypename(withTypename);
    expect("__typename" in cleaned).toBe(false);
  });

  it("preserves every other field verbatim", () => {
    const withTypename = { ...baseFlags, __typename: "RankingFlags" };
    expect(stripTypename(withTypename)).toEqual(baseFlags);
  });

  it("is a no-op when the input has no __typename", () => {
    expect(stripTypename(baseFlags)).toEqual(baseFlags);
  });
});

describe("topAxisFor", () => {
  const zeros: AxisScores = {
    directMaterial: 0,
    valuesAlignment: 0,
    actionability: 0,
    indirectMaterial: 0,
    coalitionSignal: 0,
    counterfactual: 0,
    noveltyRepetition: 0,
  };

  it("picks the highest of axes 1–3", () => {
    expect(
      topAxisFor({ ...zeros, directMaterial: 0.8, valuesAlignment: 0.3 }),
    ).toBe("directMaterial");
    expect(
      topAxisFor({ ...zeros, valuesAlignment: 0.9, actionability: 0.2 }),
    ).toBe("valuesAlignment");
    expect(
      topAxisFor({ ...zeros, actionability: 0.7, valuesAlignment: 0.6 }),
    ).toBe("actionability");
  });

  it("ignores v1.1 placeholder axes (4–7) even if they happen to be non-zero", () => {
    // v1.0 contract: axes 4-7 return 0.0; if a test fixture ever leaks
    // a non-zero, the heuristic must still pick from axes 1-3.
    expect(
      topAxisFor({
        ...zeros,
        directMaterial: 0.1,
        indirectMaterial: 0.9,
        coalitionSignal: 0.9,
      }),
    ).toBe("directMaterial");
  });

  it("falls back to directMaterial when every axis is zero", () => {
    expect(topAxisFor(zeros)).toBe("directMaterial");
  });
});
