"use client";

import { useEffect, useRef, useState } from "react";

/** Matches the committees-page precedent (#672) and the header search. */
export const LIST_SEARCH_DEBOUNCE_MS = 150;

/**
 * Debounced search box for a region list page (#1155).
 *
 * Owns only the debounce and the markup; the page owns the committed
 * value and resets its own pagination, because "what a new search does
 * to page state" differs per page.
 *
 * The label is `sr-only` rather than absent — a placeholder is not an
 * accessible name, and these inputs are the primary control on the page.
 */
export function ListSearchInput({
  label,
  placeholder,
  onSearch,
  initialValue = "",
  inputRef,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly onSearch: (value: string) => void;
  readonly initialValue?: string;
  /** Lets a page restore focus here after clearing filters. */
  readonly inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [input, setInput] = useState(initialValue);

  // Callers pass an inline arrow, so `onSearch` is a new function on every
  // parent render — depending on it would restart the timer forever and it
  // would never fire. Holding the latest callback in a ref lets the effect
  // depend only on `input` while still calling current code, rather than
  // relying on an unstated invariant about what the closure captured.
  const latest = useRef(onSearch);
  useEffect(() => {
    latest.current = onSearch;
  });

  useEffect(() => {
    const handle = setTimeout(
      () => latest.current(input.trim()),
      LIST_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [input]);

  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        ref={inputRef}
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-content placeholder:text-content-dim focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}
