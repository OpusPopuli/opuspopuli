import type { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Gold-bar pull-quote — gold as a ≥3px left-border accent, Playfair italic.
 * The declarative, argumentative voice of the brand.
 */
export function Declaration({
  className,
  ...props
}: HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className={cn(
        "declaration philosophy text-xl md:text-2xl text-content",
        className,
      )}
      {...props}
    />
  );
}
