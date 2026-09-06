"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while rendering on the server and during the client's first render,
 * true afterwards.
 *
 * For gating anything whose value the server could not have known. The case
 * this exists for: Apollo persists its cache to IndexedDB, so a returning
 * visitor's first client render already has query data while the server's
 * render had none. Branching the tree on that data then produces a hydration
 * mismatch, and React responds by discarding and re-rendering the subtree.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server
 * snapshot is a first-class concept here, and it avoids a setState-in-effect
 * that the lint config rightly objects to.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
