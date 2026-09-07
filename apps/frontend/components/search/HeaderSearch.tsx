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
  type SearchSuggestionKind,
} from "@/lib/graphql/region";

/** Matches the committees-page precedent; typeahead fires per keystroke. */
const SEARCH_DEBOUNCE_MS = 150;
const MIN_QUERY_LENGTH = 2;
const SUGGEST_TAKE = 8;

type Row =
  | { type: "suggestion"; suggestion: SearchSuggestion }
  | { type: "seeAll" };

/**
 * Row styling.
 *
 * Every row carries a 3px left rule so nothing shifts as state changes:
 * DIRECT rows show it in gold (an earned ≥3px accent, per the brand
 * rules) to mark the "jump to bill" shortcut; the keyboard-active row
 * shows it in ink.
 *
 * The active row's ink rule is load-bearing for accessibility: the old
 * indicator was `bg-surface-alt` on `bg-surface`, which is 1.07:1 and
 * therefore invisible (SC 1.4.11 needs 3:1 for a non-text indicator).
 * Ink on either row background clears 12:1 (#1154 review).
 */
function rowRuleClass(kind: SearchSuggestionKind, active: boolean): string {
  if (active) return "border-l-[3px] border-content bg-surface-alt";
  if (kind === "DIRECT") return "border-l-[3px] border-accent";
  return "border-l-[3px] border-transparent";
}

function rowHref(row: Row, query: string): string {
  if (row.type === "seeAll") {
    return `/region/search?q=${encodeURIComponent(query)}`;
  }
  // Ids are server-supplied; encode them so a malformed one can only ever
  // be a bad path segment, never structure.
  const { suggestion } = row;
  const id = encodeURIComponent(suggestion.id);
  return suggestion.kind === "PROPOSITION"
    ? `/region/propositions/${id}`
    : `/region/bills/${id}`;
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

  // Clamp the active row when the list shrinks under it. Suggestions
  // arrive asynchronously, so a held ArrowDown can leave activeIndex
  // past the end — Enter would then read rows[undefined] and throw, and
  // aria-activedescendant would point at a nonexistent id (#1154 review).
  useEffect(() => {
    setActiveIndex((i) => (i >= rows.length ? -1 : i));
  }, [rows.length]);

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
        navigateTo(rows[activeIndex] ?? { type: "seeAll" });
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
    // Rows are NOT links, deliberately. Wrapping the content in an <a>
    // would restore cmd/middle-click, but an interactive element inside
    // role="option" is a nested-interactive axe violation (caught by
    // region-search.a11y.test.tsx). The ARIA listbox pattern requires
    // non-interactive options; the results page carries the real links.
    if (row.type === "seeAll") {
      return (
        <li
          key="see-all"
          id={optionId(index)}
          role="option"
          aria-selected={active}
          className={`cursor-pointer border-t border-line px-4 py-2.5 text-sm text-content underline decoration-line underline-offset-2 ${active ? "bg-surface-alt" : ""}`}
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
        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${rowRuleClass(suggestion.kind, active)}`}
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
          aria-describedby={`${listboxId}-hint`}
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
        {/* The glyph is decorative; the shortcut itself is announced via
            aria-describedby so it isn't documented to sighted mouse users
            only (a `title` is unreachable by keyboard). */}
        <kbd
          className="rounded border border-line bg-surface-alt px-1 font-mono text-[11px] text-content-dim"
          aria-hidden="true"
        >
          /
        </kbd>
        <span id={`${listboxId}-hint`} className="sr-only">
          {t("search.shortcutHint")}
        </span>
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
