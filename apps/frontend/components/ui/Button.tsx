import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

/**
 * Brand button. Gold is earned: the `gold` variant is a filled shape with ink
 * text, valid on both themes. Never renders gold text on paper. Hover on gold
 * shifts to `accent-strong` rather than swapping the hue.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium " +
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        gold: "bg-accent text-on-accent hover:bg-accent-strong",
        secondary: "bg-inverse-surface text-on-inverse hover:opacity-90",
        ghost: "border border-line text-content hover:bg-surface-alt",
      },
      size: {
        sm: "text-sm px-3 py-1.5",
        md: "text-sm px-4 py-2",
        lg: "text-base px-6 py-3",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { button as buttonVariants };
