"use client";

import { Sunflower } from "@/components/brand";

interface LoadingSpinnerProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

// The loading-state mark: the sunflower head spins like a pinwheel (globals.css
// `.s-loading`). Respects prefers-reduced-motion. Sizes preserve the old API.
const sizePx = { sm: 24, md: 40, lg: 64 } as const;

export function LoadingSpinner({
  size = "sm",
  className = "",
}: Readonly<LoadingSpinnerProps>) {
  return (
    <Sunflower state="loading" size={sizePx[size]} className={className} />
  );
}
