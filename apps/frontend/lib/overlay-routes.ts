/**
 * Route prefixes where global fixed-position overlays (the scan FAB, the
 * install-app banner) must not render:
 *
 *  - the petition area: the camera is a full-screen black overlay, and a
 *    floating element over the live viewfinder is noise at best and covers
 *    the capture controls at worst;
 *  - the auth screens (login/register/callback): minimal, focused flows;
 *  - onboarding: the same, and worse — on iOS the install banner is a
 *    full-width `inset-x-4` bar (it only becomes a corner card at `sm:`),
 *    so it sat directly on top of the onboarding controls and swallowed
 *    taps. iOS has no `beforeinstallprompt`, so it shows the manual
 *    Share → Add to Home Screen recipe instead, which is why this hit
 *    mobile Safari and not mobile Chrome.
 *
 * Shared so every global overlay hides on the same surfaces — the install
 * banner shipped without this once and floated over the camera (review
 * finding on the PWA install branch), then again over onboarding (#1077).
 * When adding a focused full-screen flow, add it here at the same time.
 */
export const OVERLAY_HIDDEN_PREFIXES = [
  "/petition",
  "/login",
  "/register",
  "/auth",
  "/onboarding",
] as const;

export function isOverlayHiddenRoute(
  pathname: string | null | undefined,
): boolean {
  return OVERLAY_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
}
