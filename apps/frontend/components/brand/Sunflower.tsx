import { cn } from "@/lib/ui/cn";

/*
 * The mark. One continuous line from root to last petal — the junction hidden
 * beneath the disc. The stem never moves; the head rotates on the sun. Gold
 * (#E8C000) is the only colour, and it is the disc. The line uses currentColor
 * so it inherits `text-content` and flips with the theme / .on-ink surfaces.
 *
 * Motion states (CSS in globals.css): idle=sway, loading=pinwheel, success=bloom.
 * All respect prefers-reduced-motion.
 */
const HEAD =
  "M 50 40 C 50 36, 49 30, 50 26 C 51 22, 53 20, 50 18 C 47 20, 47 26, 48 31 C 46 27, 43 22, 40 21 C 36 20, 34 24, 35 28 C 36 32, 40 34, 44 33 C 40 35, 35 37, 34 41 C 33 45, 35 49, 38 50 C 41 51, 45 49, 46 46 C 44 50, 43 56, 45 60 C 47 64, 51 65, 54 63 C 57 61, 57 57, 55 53 C 58 57, 62 60, 66 59 C 70 58, 71 54, 69 50 C 67 46, 63 44, 59 45 C 63 43, 67 39, 66 35 C 65 31, 61 29, 57 31 C 54 33, 53 37, 54 40";

interface SunflowerProps {
  state?: "idle" | "loading" | "success" | "static";
  size?: number;
  title?: string;
  className?: string;
}

export function Sunflower({
  state = "idle",
  size = 56,
  title,
  className,
}: SunflowerProps) {
  const sw = size <= 40 ? 1.8 : 1.6;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={cn(
        state !== "static" && `s-${state}`,
        "text-content",
        className,
      )}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
    >
      {title && <title>{title}</title>}
      <line
        x1="50"
        y1="88"
        x2="50"
        y2="40"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <g className="op-head">
        <path
          d={HEAD}
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="50" cy="40" r="10" fill="#E8C000" />
      </g>
    </svg>
  );
}
