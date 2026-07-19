import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

/**
 * Hairline card — depth from borders + warm tonal steps, never shadows.
 * `accent="left"` is the brand's gold left-border motif (gold as a ≥3px accent).
 */
const card = cva("rounded-lg border border-line", {
  variants: {
    accent: { none: "", left: "border-l-[3px] border-l-accent" },
    tone: {
      plain: "bg-surface",
      alt: "bg-surface-alt",
      sunk: "bg-surface-sunk",
    },
    pad: { none: "", sm: "p-4", md: "p-6", lg: "p-8" },
  },
  defaultVariants: { accent: "none", tone: "plain", pad: "md" },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof card> {}

export function Card({ className, accent, tone, pad, ...props }: CardProps) {
  return (
    <div className={cn(card({ accent, tone, pad }), className)} {...props} />
  );
}
