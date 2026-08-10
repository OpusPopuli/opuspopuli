/**
 * Brand lockup, theme-aware.
 *
 * The asset names describe the ARTWORK, not the background it sits on:
 * `op-horizontal-light.svg` is drawn in paper (#FAFAF8) and is meant for ink
 * surfaces; `op-horizontal-dark.svg` is drawn in ink (#1A1714) for paper
 * surfaces. Picking by name alone is how the login header ended up rendering
 * as a lone gold dot on the paper background.
 *
 * Both variants are rendered and toggled with CSS rather than read from the
 * theme context, so the correct one is present in the very first paint — no
 * hydration mismatch and no flash on reload.
 */
// The lockup is 600x150. The "OPUS POPULI" wordmark is ~23% of that height and
// the "The Work of the People" subtitle only ~13%, so rendered size matters a
// lot: at h-8 the subtitle is ~4px and at h-12 it is ~6px — both illegible.
// h-28 puts the subtitle at ~15px. Anywhere the lockup can't be given at least
// h-20, use variant="mark" instead of shrinking it into mush.
export function Logo({
  className = "h-20",
  variant = "horizontal",
}: {
  readonly className?: string;
  readonly variant?: "horizontal" | "mark";
}) {
  const base = variant === "horizontal" ? "op-horizontal" : "op-mark";
  return (
    <>
      {/* ink artwork — light theme */}
      <img
        src={`/logos/svg/${base}-dark.svg`}
        alt="Opus Populi"
        className={`${className} w-auto max-w-full block dark:hidden`}
      />
      {/* paper artwork — dark theme */}
      <img
        src={`/logos/svg/${base}-light.svg`}
        alt=""
        aria-hidden="true"
        className={`${className} w-auto max-w-full hidden dark:block`}
      />
    </>
  );
}
