"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the reader has asked for less motion.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: matchMedia
 * IS an external store, and reading it through an effect means rendering once
 * with the wrong answer and again with the right one. The server snapshot
 * returns false because `window.matchMedia` does not exist during SSR.
 *
 * Read this in the component that owns the decision and thread the boolean
 * down, so presentational components stay pure and the media query has exactly
 * one owner per screen.
 *
 * Only for motion JavaScript actually drives. Anything animated in CSS should
 * use the `@media (prefers-reduced-motion: reduce)` block in `globals.css`
 * instead, which is how the brand marks do it.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia(QUERY);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
