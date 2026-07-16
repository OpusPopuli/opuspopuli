import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Text input — hairline border, warm surface, gold focus ring. No shadow.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full rounded-lg border border-line bg-surface px-3 py-2 text-content",
      "placeholder:text-content-dim transition-colors",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:opacity-50 disabled:pointer-events-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
