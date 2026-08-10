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
// never gold text on paper). warning/danger use the status ramp, which already
// flips with the theme, so no `dark:` variants are needed here.
// Lookup-table dispatch keeps cognitive complexity at 1.
const TONE_CLASSES: Record<StatusPillTone, string> = {
  "sage-filled": "bg-accent text-on-accent",
  "sage-outline": "border border-accent text-content",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
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
