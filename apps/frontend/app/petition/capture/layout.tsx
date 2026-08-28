"use client";

/**
 * The camera shell, scoped to the one route that needs it (#1075).
 *
 * This used to wrap the whole `/petition` subtree, which meant the landing
 * page, the results page and the map all rendered as full-bleed black panels
 * with no header, no footer and no theme response — a viewfinder chrome
 * applied to pages that are not a viewfinder.
 *
 * `on-fixed-dark`, not `on-ink`: the camera feed is black in BOTH themes.
 * `on-ink` inverts in dark theme (to a paper panel), which would put ink-
 * coloured text over the black video. `on-fixed-dark` pins the tokens instead.
 */
export default function PetitionCaptureLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="fixed inset-0 bg-black on-fixed-dark">{children}</div>;
}
