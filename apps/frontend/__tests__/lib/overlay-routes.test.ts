import {
  OVERLAY_HIDDEN_PREFIXES,
  isOverlayHiddenRoute,
} from "@/lib/overlay-routes";

/**
 * Global fixed-position overlays (the scan FAB, the install-app banner) must
 * not render on focused full-screen flows.
 *
 * This has now gone wrong twice. First the install banner floated over the
 * camera viewfinder. Then — #1077 — it covered onboarding on iOS, where the
 * banner is a full-width `inset-x-4` bar rather than the `sm:` corner card,
 * so it sat on the controls and swallowed taps. It reached CI as ten
 * onboarding e2e timeouts on mobile-safari, and it was a real bug: a new
 * iPhone user could not complete onboarding.
 *
 * It only hit mobile Safari because iOS has no `beforeinstallprompt`, so the
 * banner shows the manual Share → Add to Home Screen recipe there.
 */
describe("overlay-routes", () => {
  it.each([
    ["/petition", "camera viewfinder"],
    ["/login", "auth"],
    ["/register", "auth"],
    ["/auth", "auth callback"],
    ["/onboarding", "first-run flow"],
  ])("hides overlays on %s (%s)", (route) => {
    expect(isOverlayHiddenRoute(route)).toBe(true);
  });

  it("hides overlays on nested routes of a hidden prefix", () => {
    expect(isOverlayHiddenRoute("/onboarding/step-2")).toBe(true);
    expect(isOverlayHiddenRoute("/petition/capture")).toBe(true);
  });

  it("still shows overlays on ordinary surfaces", () => {
    for (const route of ["/region", "/settings", "/settings/scans", "/"]) {
      expect(isOverlayHiddenRoute(route)).toBe(false);
    }
  });

  it("tolerates a null or undefined pathname", () => {
    expect(isOverlayHiddenRoute(null)).toBe(false);
    expect(isOverlayHiddenRoute(undefined)).toBe(false);
  });

  /**
   * Pins onboarding specifically. Removing it from the list is what broke
   * iPhone onboarding, and nothing else in the suite would notice.
   */
  it("keeps /onboarding in the hidden list", () => {
    expect(OVERLAY_HIDDEN_PREFIXES).toContain("/onboarding");
  });
});
