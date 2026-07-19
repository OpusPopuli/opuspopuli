import type { ReactNode } from "react";

export type StatusPillTone =
  | "sage-filled"
  | "sage-outline"
  | "warning"
  | "danger"
  | "neutral";

interface StatusPillProps {
  readonly tone: StatusPillTone;
  readonly children: ReactNode;
}

// Status pill. The positive/brand tones are the earned gold (fill / outline —
// never gold text on paper). warning/danger keep conventional traffic-light
// semantics (these are the few legitimate `dark:` survivors — semantic status
// colours, not structure). Lookup-table dispatch keeps cognitive complexity at 1.
const TONE_CLASSES: Record<StatusPillTone, string> = {
  "sage-filled": "bg-accent text-on-accent",
  "sage-outline": "border border-accent text-content",
  warning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  neutral: "bg-surface-alt text-content-dim",
};

export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
