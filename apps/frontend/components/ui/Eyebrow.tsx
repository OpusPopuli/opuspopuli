import type { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The signature kicker label — 10px, 0.28em uppercase, preceded by a hairline.
 * Styling lives in the `.eyebrow` class in globals.css so it flips with theme
 * and inverts correctly inside `.on-ink` surfaces.
 */
export function Eyebrow({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("eyebrow", className)} {...props} />;
}
