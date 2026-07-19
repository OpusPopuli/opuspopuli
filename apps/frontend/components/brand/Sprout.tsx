import { cn } from "@/lib/ui/cn";

/*
 * The citizen growing. Between seed and flower: the line rising from the seed's
 * opening. First briefing read, first action taken — the middle of the story.
 */
interface SproutProps {
  size?: number;
  title?: string;
  className?: string;
}

export function Sprout({ size = 32, title, className }: SproutProps) {
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
      <path
        d="M 44 62 C 40 65, 38 70, 40 74 C 42 78, 48 79, 52 77 C 56 75, 58 70, 56 66 C 55 63, 51 61, 48 62 Z"
        fill="#E8C000"
      />
      <path
        d="M 44 60 C 39 63, 36 69, 38 74 C 40 79, 47 81, 52 78 C 57 75, 59 69, 56 64"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 48 62 C 48 52, 49 44, 50 36 C 46 34, 41 30, 42 24 C 48 25, 51 30, 50 36 C 54 33, 59 32, 62 27 C 56 25, 52 29, 50 34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
