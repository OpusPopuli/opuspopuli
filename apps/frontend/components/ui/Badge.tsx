import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

/**
 * Small status/label pill. `neutral` is the default warm chip; `accent` is a
 * gold fill with ink text (earned). Traffic-light status semantics
 * (warning/danger/success) live in StatusPill, not here.
 */
const badge = cva(
  "inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5",
  {
    variants: {
      variant: {
        neutral: "bg-surface-alt text-content-dim",
        outline: "border border-line text-content-dim",
        accent: "bg-accent text-on-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant }), className)} {...props} />;
}
