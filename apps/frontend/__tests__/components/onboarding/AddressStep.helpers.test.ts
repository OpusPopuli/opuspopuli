/**
 * Unit tests for the pure helpers in AddressStep.
 *
 * `pickExistingAddress` decides whether the AddressStep submit goes
 * down the CREATE or UPDATE path. Getting it wrong stacks duplicate
 * rows on retry — the very bug this branch fixed.
 */
import { pickExistingAddress } from "@/components/onboarding/steps/AddressStep";
import type { UserAddress } from "@/lib/graphql/profile";

const mk = (
  overrides: Partial<UserAddress> & Pick<UserAddress, "id">,
): UserAddress => ({
  userId: "u-1",
  addressType: "RESIDENTIAL",
  isPrimary: false,
  addressLine1: "100 Main St",
  city: "Berkeley",
  state: "CA",
  postalCode: "94704",
  country: "US",
  isVerified: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...overrides,
});

describe("pickExistingAddress", () => {
  it("returns null when the list is undefined or empty", () => {
    expect(pickExistingAddress(undefined)).toBeNull();
    expect(pickExistingAddress([])).toBeNull();
  });

  it("prefers a primary RESIDENTIAL when one exists", () => {
    const primary = mk({ id: "a", isPrimary: true });
    const secondary = mk({ id: "b", isPrimary: false });
    expect(pickExistingAddress([secondary, primary])?.id).toBe("a");
  });

  it("falls back to any RESIDENTIAL when no primary exists", () => {
    const mailing = mk({ id: "m", addressType: "MAILING" });
    const residential = mk({ id: "r", addressType: "RESIDENTIAL" });
    expect(pickExistingAddress([mailing, residential])?.id).toBe("r");
  });

  it("falls back to the first row when no RESIDENTIAL exists", () => {
    const mailing = mk({ id: "m", addressType: "MAILING" });
    const business = mk({ id: "b", addressType: "BUSINESS" });
    expect(pickExistingAddress([mailing, business])?.id).toBe("m");
  });

  it("prefers primary RESIDENTIAL over a non-primary RESIDENTIAL", () => {
    const nonPrimaryR = mk({ id: "x", isPrimary: false });
    const primaryR = mk({ id: "y", isPrimary: true });
    expect(pickExistingAddress([nonPrimaryR, primaryR])?.id).toBe("y");
  });
});
