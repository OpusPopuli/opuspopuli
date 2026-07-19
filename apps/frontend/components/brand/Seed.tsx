import { cn } from "@/lib/ui/cn";

/*
 * The citizen. One small unbroken teardrop, open at the top — potential, not
 * completion. Gold means activation: a dormant seed is line only; when a citizen
 * acts, it fills. The outline uses currentColor (inherits text-content).
 */
interface SeedProps {
  activated?: boolean;
  size?: number;
  title?: string;
  className?: string;
}

export function Seed({
  activated = false,
  size = 24,
  title,
  className,
}: SeedProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={cn("text-content", className)}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
    >
      {title && <title>{title}</title>}
      {activated && (
        <path
          className="seed-fill"
          d="M 46 30 C 40 35, 36 44, 36 52 C 36 61, 42 68, 50 68 C 58 68, 64 61, 64 52 C 64 44, 60 35, 54 30 C 52 28.5, 48 28.5, 46 30 Z"
          fill="#E8C000"
        />
      )}
      <path
        d="M 46 26 C 38 32, 32 42, 32 52 C 32 64, 40 72, 50 72 C 60 72, 68 64, 68 52 C 68 42, 62 32, 54 26"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
