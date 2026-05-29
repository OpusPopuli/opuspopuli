/**
 * Unit tests for the pure mapping helpers in LifeContextStep.
 *
 * The chip vocabulary <-> SignalProfile field mapping is the cross-
 * service contract that the knowledge ranker (#743 `scoring.service`
 * WHO_TO_FLAG table) relies on. Drift here silently miscategorizes
 * users, so the round-trip is worth exercising explicitly.
 */
import {
  fromSignalProfile,
  sameLifeContext,
  toSignalInput,
  type LifeContextState,
} from "@/components/onboarding/steps/LifeContextStep";
import type { SignalProfile } from "@/lib/graphql/personalization";

const emptyState: LifeContextState = {
  housing: null,
  family: [],
  workStatus: null,
  workExtras: [],
  education: [],
  transit: null,
};

const baseProfile: SignalProfile = {
  id: "sp-1",
  userId: "u-1",
};

describe("fromSignalProfile", () => {
  it("returns the empty state when the profile is null", () => {
    expect(fromSignalProfile(null)).toEqual(emptyState);
  });

  it("rebuilds every chip group from granular fields", () => {
    expect(
      fromSignalProfile({
        ...baseProfile,
        housingTenure: "renter",
        parentOfStudent: ["public"],
        hasEldercareDependents: true,
        employmentStatus: "employed",
        unionMember: true,
        studentLevel: "college",
        educator: true,
        primaryTransitMode: "transit",
      }),
    ).toEqual({
      housing: "renter",
      family: ["parent", "caregiver"],
      workStatus: "employed",
      workExtras: ["union"],
      education: ["student", "educator"],
      transit: "transit",
    });
  });

  it("collapses any studentLevel value to the single 'student' chip", () => {
    // The onboarding chip offers one option — K12/college/grad all
    // map to it. toSignalInput then re-writes 'college' on save,
    // which is why the skip-write-if-unchanged guard exists for
    // returning users with non-college values.
    for (const level of ["K12", "college", "grad"]) {
      const result = fromSignalProfile({
        ...baseProfile,
        studentLevel: level,
      });
      expect(result.education).toContain("student");
    }
  });

  it("treats parentOfStudent as 'parent' chip only when non-empty", () => {
    expect(
      fromSignalProfile({ ...baseProfile, parentOfStudent: [] }).family,
    ).not.toContain("parent");
    expect(
      fromSignalProfile({ ...baseProfile, parentOfStudent: ["public"] }).family,
    ).toContain("parent");
    expect(
      fromSignalProfile({
        ...baseProfile,
        parentOfStudent: ["public", "private"],
      }).family,
    ).toContain("parent");
  });

  it("treats unionMember=false as no union chip", () => {
    expect(
      fromSignalProfile({ ...baseProfile, unionMember: false }).workExtras,
    ).toEqual([]);
  });
});

describe("toSignalInput", () => {
  it("returns an empty input for the empty state", () => {
    expect(toSignalInput(emptyState)).toEqual({});
  });

  it("round-trips a fully-populated state back to granular fields", () => {
    const state: LifeContextState = {
      housing: "renter",
      family: ["parent", "caregiver"],
      workStatus: "employed",
      workExtras: ["union"],
      education: ["student", "educator"],
      transit: "transit",
    };
    expect(toSignalInput(state)).toEqual({
      housingTenure: "renter",
      parentOfStudent: ["public"],
      hasEldercareDependents: true,
      employmentStatus: "employed",
      unionMember: true,
      studentLevel: "college",
      educator: true,
      primaryTransitMode: "transit",
    });
  });

  it("never writes fields the user didn't pick", () => {
    expect(toSignalInput({ ...emptyState, housing: "owner" })).toEqual({
      housingTenure: "owner",
    });
  });
});

describe("sameLifeContext", () => {
  const a: LifeContextState = {
    housing: "renter",
    family: ["parent"],
    workStatus: "employed",
    workExtras: ["union"],
    education: ["student"],
    transit: "transit",
  };

  it("is true for identical states", () => {
    expect(sameLifeContext(a, { ...a })).toBe(true);
  });

  it("ignores ordering within multi-select arrays", () => {
    expect(
      sameLifeContext(
        { ...a, family: ["parent", "caregiver"] },
        { ...a, family: ["caregiver", "parent"] },
      ),
    ).toBe(true);
  });

  it("is false when housing differs", () => {
    expect(sameLifeContext(a, { ...a, housing: "owner" })).toBe(false);
  });

  it("is false when array lengths differ", () => {
    expect(sameLifeContext(a, { ...a, family: [] })).toBe(false);
  });
});
