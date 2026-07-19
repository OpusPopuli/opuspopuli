import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { Eyebrow } from "./Eyebrow";

type Background = "surface" | "alt" | "ink";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  background?: Background;
  className?: string;
  children?: ReactNode;
}

const BACKGROUND: Record<Background, string> = {
  surface: "bg-surface",
  alt: "bg-surface-alt",
  ink: "bg-inverse-surface text-on-inverse on-ink",
};

/**
 * Editorial section wrapper — max-w-5xl column, warm background steps, optional
 * eyebrow/title/subtitle header. `background="ink"` renders a dark inverse panel
 * (via `.on-ink`, which flips nested semantic-token utilities).
 */
export function Section({
  id,
  eyebrow,
  title,
  subtitle,
  background = "surface",
  className,
  children,
}: SectionProps) {
  const hasHeader = eyebrow || title || subtitle;
  return (
    <section
      id={id}
      className={cn("py-20 md:py-28", BACKGROUND[background], className)}
    >
      <div className="container mx-auto max-w-5xl px-6">
        {hasHeader && (
          <div className="mb-16 max-w-2xl">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && (
              <h2 className="stitle mb-3 text-2xl md:text-3xl">{title}</h2>
            )}
            {subtitle && (
              <p className="text-base text-content-dim">{subtitle}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
