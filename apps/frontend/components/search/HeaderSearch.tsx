"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  REGION_SEARCH_SUGGEST,
  type RegionSearchSuggestData,
  type RegionSearchSuggestVars,
  type SearchSuggestion,
} from "@/lib/graphql/region";

/** Matches the committees-page precedent; typeahead fires per keystroke. */
const SEARCH_DEBOUNCE_MS = 150;
const MIN_QUERY_LENGTH = 2;
const SUGGEST_TAKE = 8;

type Row =
  | { type: "suggestion"; suggestion: SearchSuggestion }
  | { type: "seeAll" };

function rowHref(row: Row, query: string): string {
  if (row.type === "seeAll") {
    return `/region/search?q=${encodeURIComponent(query)}`;
  }
  const { suggestion } = row;
  return suggestion.kind === "PROPOSITION"
    ? `/region/propositions/${suggestion.id}`
    : `/region/bills/${suggestion.id}`;
}

/**
 * Global header search with typeahead (#1154). WAI-ARIA combobox
 * pattern: the input owns focus, arrow keys move aria-activedescendant
 * over the listbox rows, Enter opens the active row (or the full
 * results page when none is active), Escape dismisses. `/` focuses the
 * field from anywhere that isn't already an editable control.
 */
export function HeaderSearch() {
  const { t } = useTranslation("region");
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const handle = setTimeout(
      () => setDebounced(input.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [input]);

  const skip = debounced.length < MIN_QUERY_LENGTH;
  const { data } = useQuery<RegionSearchSuggestData, RegionSearchSuggestVars>(
    REGION_SEARCH_SUGGEST,
    { variables: { query: debounced, take: SUGGEST_TAKE }, skip },
  );

  // Navigation reads the LIVE input, never `debounced` — the debounce
  // exists to throttle the suggest query, and gating Enter on it means a
  // fast typist who hits Enter inside the debounce window gets nothing.
  const trimmedInput = input.trim();

  const suggestions = useMemo(
    () => (skip ? [] : (data?.regionSearchSuggest ?? [])),
    [skip, data?.regionSearchSuggest],
  );
  const rows = useMemo<Row[]>(() => {
    if (trimmedInput.length < MIN_QUERY_LENGTH) return [];
    return [
      ...suggestions.map<Row>((s) => ({ type: "suggestion", suggestion: s })),
      { type: "seeAll" },
    ];
  }, [suggestions, trimmedInput]);

  const showList = open && rows.length > 0;

  // "/" focuses the field from anywhere that isn't already editable.
  useEffect(() => {
    function onSlash(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onSlash);
    return () => document.removeEventListener("keydown", onSlash);
  }, []);

  const navigateTo = useCallback(
    (row: Row) => {
      setOpen(false);
      setActiveIndex(-1);
      router.push(rowHref(row, trimmedInput));
    },
    [router, trimmedInput],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!rows.length) {
      if (e.key === "Enter" && trimmedInput.length >= MIN_QUERY_LENGTH) {
        navigateTo({ type: "seeAll" });
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (i + 1) % rows.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1));
        break;
      case "Enter":
        navigateTo(activeIndex >= 0 ? rows[activeIndex] : { type: "seeAll" });
        break;
      default:
        break;
    }
  }

  // Close when focus leaves the whole widget (option clicks use
  // onMouseDown-preventDefault so they run before this fires).
  function onBlur(e: React.FocusEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function optionId(index: number) {
    return `${listboxId}-option-${index}`;
  }

  function renderRow(row: Row, index: number) {
    const active = index === activeIndex;
    const baseClass = active ? "bg-surface-alt" : "";
    if (row.type === "seeAll") {
      return (
        <li
          key="see-all"
          id={optionId(index)}
          role="option"
          aria-selected={active}
          className={`cursor-pointer border-t border-line px-4 py-2.5 text-sm text-content underline decoration-line underline-offset-2 ${baseClass}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => navigateTo(row)}
        >
          {t("search.seeAll", { query: trimmedInput })}
        </li>
      );
    }
    const { suggestion } = row;
    return (
      <li
        key={suggestion.kind + suggestion.id}
        id={optionId(index)}
        role="option"
        aria-selected={active}
        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${
          suggestion.kind === "DIRECT"
            ? `border-l-[3px] ${active ? "border-accent bg-surface-alt" : "border-transparent"}`
            : baseClass
        }`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => navigateTo(row)}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-content">
          {suggestion.label}
        </span>
        {suggestion.sublabel && (
          <span className="shrink-0 font-mono text-xs text-content-dim">
            {suggestion.sublabel}
          </span>
        )}
        {suggestion.kind === "DIRECT" && (
          <span className="shrink-0 text-xs text-content-dim">
            {t("search.jumpToBill")}
          </span>
        )}
      </li>
    );
  }

  return (
    <div ref={containerRef} className="relative" onBlur={onBlur}>
      <div className="flex w-56 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 focus-within:ring-2 focus-within:ring-accent">
        <svg
          className="h-4 w-4 shrink-0 text-content-dim"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" strokeLinecap="round" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={
            showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-autocomplete="list"
          aria-label={t("search.inputLabel")}
          placeholder={t("search.placeholder")}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-dim"
        />
        <kbd
          className="rounded border border-line bg-surface-alt px-1 font-mono text-[11px] text-content-dim"
          title={t("search.shortcutHint")}
          aria-hidden="true"
        >
          /
        </kbd>
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-label={t("search.inputLabel")}
        className={`absolute right-0 top-11 z-50 w-[min(560px,90vw)] overflow-hidden rounded-lg border border-line bg-surface ${
          showList ? "" : "hidden"
        }`}
      >
        {rows.map((row, i) => renderRow(row, i))}
      </ul>
    </div>
  );
}
