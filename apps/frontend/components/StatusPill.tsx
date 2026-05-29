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

// Token-driven status pill — sage tones map to brand, warning/danger/neutral
// preserve the conventional traffic-light semantics for transitional/negative/
// informational states. Lookup table dispatch keeps cognitive complexity at
// 1 regardless of how many tones get added.
const TONE_CLASSES: Record<StatusPillTone, string> = {
  "sage-filled":
    "bg-sage-light/20 text-sage-darker dark:bg-sage-dark/20 dark:text-sage-light",
  "sage-outline":
    "border border-sage-dark text-sage-dark dark:border-sage-light dark:text-sage-light",
  warning:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-200",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200",
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
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
