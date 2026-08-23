/**
 * Route prefixes where global fixed-position overlays (the scan FAB, the
 * install-app banner) must not render:
 *
 *  - the petition area: the camera is a full-screen black overlay, and a
 *    floating element over the live viewfinder is noise at best and covers
 *    the capture controls at worst;
 *  - the auth screens (login/register/callback): minimal, focused flows.
 *
 * Shared so every global overlay hides on the same surfaces — the install
 * banner shipped without this once and floated over the camera (review
 * finding on the PWA install branch).
 */
export const OVERLAY_HIDDEN_PREFIXES = [
  "/petition",
  "/login",
  "/register",
  "/auth",
] as const;

export function isOverlayHiddenRoute(
  pathname: string | null | undefined,
): boolean {
  return OVERLAY_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
}
