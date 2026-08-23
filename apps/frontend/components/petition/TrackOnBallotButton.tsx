"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useLazyQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  SEARCH_PROPOSITIONS,
  LINK_DOCUMENT_TO_PROPOSITION,
  type SearchPropositionsData,
  type LinkDocumentToPropositionData,
} from "@/lib/graphql/documents";

interface TrackOnBallotButtonProps {
  readonly documentId: string;
  readonly linkedCount: number;
  readonly onLinked?: () => void;
}

export function TrackOnBallotButton({
  documentId,
  linkedCount,
  onLinked,
}: TrackOnBallotButtonProps) {
  const { t } = useTranslation("petition");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [searchPropositions, { data: searchData, loading: searching }] =
    useLazyQuery<SearchPropositionsData>(SEARCH_PROPOSITIONS);

  const [linkDocument, { loading: linking }] =
    useMutation<LinkDocumentToPropositionData>(LINK_DOCUMENT_TO_PROPOSITION);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Debounced search
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (value.length >= 3) {
        searchTimeout.current = setTimeout(() => {
          searchPropositions({ variables: { query: value } });
        }, 300);
      }
    },
    [searchPropositions],
  );

  const handleLink = useCallback(
    async (propositionId: string) => {
      try {
        await linkDocument({
          variables: {
            input: { documentId, propositionId },
          },
        });
        setOpen(false);
        setQuery("");
        onLinked?.();
      } catch {
        // Error handling via Apollo error state
      }
    },
    [linkDocument, documentId, onLinked],
  );

  const results = searchData?.searchPropositions ?? [];

  if (linkedCount > 0 && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex-1 py-3 bg-positive-solid text-on-positive font-medium rounded-lg hover:bg-positive-surface transition-colors flex items-center justify-center gap-2"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        {t("results.trackingMeasures", { count: linkedCount })}
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative flex-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-3 bg-accent text-on-accent font-medium rounded-lg hover:bg-accent-strong transition-colors"
      >
        {t("results.trackOnBallot")}
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-inverse-surface border border-line rounded-lg z-20 overflow-hidden">
          <div className="p-3">
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("results.searchPropositions")}
              className="w-full bg-inverse-surface text-on-inverse rounded-md px-3 py-2 text-sm border border-line focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              autoFocus
            />
          </div>

          <div className="max-h-48 overflow-y-auto">
            {searching && (
              <p className="px-3 py-2 text-on-inverse/70 text-sm">
                {t("activityFeed.loading")}
              </p>
            )}

            {!searching && query.length >= 3 && results.length === 0 && (
              <p className="px-3 py-2 text-on-inverse/70 text-sm">
                {t("results.noMatchesFound")}
              </p>
            )}

            {results.map((prop) => (
              <button
                key={prop.id}
                onClick={() => handleLink(prop.id)}
                disabled={linking}
                className="w-full text-left px-3 py-2 hover:bg-ink/10 transition-colors border-t border-line"
              >
                <p className="text-sm text-on-inverse truncate">{prop.title}</p>
                <p className="text-sm text-on-inverse/70">
                  {prop.externalId} &middot; {prop.status}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
