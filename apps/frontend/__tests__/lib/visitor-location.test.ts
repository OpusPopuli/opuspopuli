/**
 * A visitor's location on their own device (#1456): ids only, and every
 * storage failure survivable.
 */
import {
  MAX_VISITOR_JURISDICTIONS,
  VISITOR_LOCATION_KEY,
  clearVisitorJurisdictionIds,
  parseVisitorJurisdictionIds,
  readVisitorJurisdictionIds,
  subscribeVisitorLocation,
  visitorLocationSnapshot,
  writeVisitorJurisdictionIds,
} from "@/lib/visitor-location";

const A = "8438a0d7-a136-4071-8761-b704ab76bea7";
const B = "2fef3a2a-7497-4271-9dbd-10ad1d6ad4c4";

/** n distinct, valid UUIDs. */
const uuids = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );

describe("visitor location storage", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("round-trips ids", () => {
    expect(writeVisitorJurisdictionIds([A, B])).toBe(true);
    expect(readVisitorJurisdictionIds()).toEqual([A, B]);
  });

  it("stores ids and nothing else", () => {
    writeVisitorJurisdictionIds([A]);
    expect(localStorage.getItem(VISITOR_LOCATION_KEY)).toBe(
      JSON.stringify([A]),
    );
  });

  it("drops anything that isn't a UUID, deduplicates and caps", () => {
    expect(
      parseVisitorJurisdictionIds(
        JSON.stringify([A, A, "1315 10th St", 42, null, B]),
      ),
    ).toEqual([A, B]);
    const many = uuids(MAX_VISITOR_JURISDICTIONS + 5);
    writeVisitorJurisdictionIds(many);
    expect(readVisitorJurisdictionIds()).toHaveLength(
      MAX_VISITOR_JURISDICTIONS,
    );
  });

  it("reads malformed or foreign values as no location", () => {
    localStorage.setItem(VISITOR_LOCATION_KEY, "{not json");
    expect(readVisitorJurisdictionIds()).toEqual([]);
    localStorage.setItem(VISITOR_LOCATION_KEY, JSON.stringify({ ids: [A] }));
    expect(readVisitorJurisdictionIds()).toEqual([]);
  });

  it("survives storage that refuses to be read", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(visitorLocationSnapshot()).toBe("");
    expect(readVisitorJurisdictionIds()).toEqual([]);
  });

  it("reports a refused write instead of throwing", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeVisitorJurisdictionIds([A])).toBe(false);
  });

  it("clears, even when storage refuses", () => {
    writeVisitorJurisdictionIds([A]);
    clearVisitorJurisdictionIds();
    expect(readVisitorJurisdictionIds()).toEqual([]);
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearVisitorJurisdictionIds()).not.toThrow();
  });

  it("tells subscribers about writes and clears in this tab", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeVisitorLocation(onChange);
    writeVisitorJurisdictionIds([A]);
    clearVisitorJurisdictionIds();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeVisitorJurisdictionIds([B]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("tells subscribers about changes from other tabs, for this key only", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeVisitorLocation(onChange);
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: VISITOR_LOCATION_KEY }),
    );
    globalThis.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
