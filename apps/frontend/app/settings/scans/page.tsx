"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_SCAN_HISTORY,
  SOFT_DELETE_SCAN,
  DELETE_ALL_MY_SCANS,
  type MyScanHistoryData,
  type SoftDeleteScanData,
  type DeleteAllMyScansData,
  type ScanHistoryItem,
} from "@/lib/graphql/documents";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

type StatusKey = "analyzed" | "pending" | "failed" | "notAPetition";

/**
 * Status is rendered as a full semantic tuple (`bg-X-surface` + `text-X`), never
 * a hand-picked pair — a partial override is what produced the 1.78:1 badge
 * guarded against in e2e/design-tokens.spec.ts.
 */
const STATUS_STYLES: Record<StatusKey, { pill: string; icon: string }> = {
  analyzed: {
    pill: "bg-positive-surface text-positive",
    icon: "bg-positive-surface text-positive",
  },
  pending: {
    pill: "bg-warning-surface text-warning",
    icon: "bg-warning-surface text-warning",
  },
  notAPetition: {
    pill: "bg-warning-surface text-warning",
    icon: "bg-warning-surface text-warning",
  },
  failed: {
    pill: "bg-danger-surface text-danger",
    icon: "bg-danger-surface text-danger",
  },
};

function getStatusKey(item: ScanHistoryItem): StatusKey {
  if (item.status.includes("failed")) return "failed";
  // Non-petition verdict (#1057): the row must not read "analyzed" — the scan
  // was classified as not being a petition at all.
  if (item.isPetition === false) return "notAPetition";
  if (item.hasAnalysis) return "analyzed";
  return "pending";
}

function StatusIcon({ status }: { readonly status: StatusKey }) {
  const paths: Record<StatusKey, string> = {
    analyzed: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    pending: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    notAPetition:
      "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    failed: "M9 9l6 6m0-6l-6 6m10-3a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={paths[status]}
      />
    </svg>
  );
}

interface ScanRowProps {
  readonly item: ScanHistoryItem;
  readonly onRequestDelete: (id: string) => void;
}

function ScanRow({ item, onRequestDelete }: ScanRowProps) {
  const { t } = useTranslation("settings");
  const status = getStatusKey(item);
  const style = STATUS_STYLES[status];

  return (
    <div className="flex items-start gap-4 py-4">
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${style.icon}`}
      >
        <StatusIcon status={status} />
      </div>

      {/* The delete control is a SIBLING of the link, not a child: a button
          nested inside an anchor is invalid HTML and breaks keyboard order. */}
      <Link
        href={`/settings/scans/${item.id}`}
        className="flex-1 min-w-0 no-underline"
        aria-label={t("scans.viewDetail")}
      >
        <div className="flex items-baseline justify-between gap-3">
          {/* min-w-0 so the title can shrink instead of forcing overflow —
              belt and braces alongside the shell's responsive fix. */}
          <p className="font-medium text-content truncate min-w-0">
            {item.isPetition === false
              ? t("scans.notAPetitionItem")
              : item.summary || item.type}
          </p>
          <span className="text-sm text-content-dim flex-shrink-0">
            {new Date(item.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full ${style.pill}`}>
            {t(`scans.${status}`)}
          </span>
          {item.ocrConfidence != null && (
            <span className="text-sm text-content-dim">
              {t("scans.confidence", {
                value: item.ocrConfidence.toFixed(0),
              })}
            </span>
          )}
        </div>
      </Link>

      <button
        onClick={() => onRequestDelete(item.id)}
        className="flex-shrink-0 p-1 text-content-dim hover:text-danger transition-colors"
        aria-label={t("scans.deleteScan")}
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
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
}

export default function SettingsScansPage() {
  const { t } = useTranslation(["settings", "common"]);

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

  // Timer in a ref, not state: storing it in state made every keystroke
  // schedule a re-render whose only effect was to hold the handle.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    [],
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const filters = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
  const hasFilters = Boolean(debouncedSearch || startDate || endDate);

  const { data, loading, error, refetch } = useQuery<MyScanHistoryData>(
    GET_MY_SCAN_HISTORY,
    {
      variables: {
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        filters: hasFilters ? filters : undefined,
      },
      fetchPolicy: "cache-and-network",
    },
  );

  const [softDeleteScan] = useMutation<SoftDeleteScanData>(SOFT_DELETE_SCAN);
  const [deleteAllMyScans] =
    useMutation<DeleteAllMyScansData>(DELETE_ALL_MY_SCANS);

  const items = data?.myScanHistory?.items ?? [];
  const total = data?.myScanHistory?.total ?? 0;
  const hasMore = data?.myScanHistory?.hasMore ?? false;

  const handleDelete = async (documentId: string) => {
    // Deleting the only row on a trailing page would otherwise leave the user
    // on an empty page: `total` drops to a single page's worth, the pagination
    // block hides, and the empty state claims there are no scans at all. Step
    // back a page instead — the state change refetches on its own.
    const wasLastOnTrailingPage = items.length === 1 && page > 0;
    await softDeleteScan({ variables: { documentId } });
    setDeleteConfirmId(null);
    if (wasLastOnTrailingPage) {
      setPage((p) => p - 1);
    } else {
      refetch();
    }
  };

  const handleDeleteAll = async () => {
    await deleteAllMyScans();
    setDeleteAllConfirm(false);
    setPage(0);
    refetch();
  };

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStartDate("");
    setEndDate("");
    setPage(0);
  };

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-content">
          {t("scans.title")}
        </h1>
        <p className="mt-1 text-sm text-content-dim">
          {total > 0
            ? t("scans.subtitleCount", { count: total })
            : t("scans.subtitle")}
        </p>
      </div>

      {/* Filters + list */}
      <div className="bg-surface rounded-lg border border-line">
        <div className="flex flex-wrap gap-3 p-4 border-b border-line">
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("scans.search")}
            aria-label={t("scans.search")}
            className="flex-1 min-w-[12rem] px-4 py-2 rounded-lg border border-line bg-surface text-content focus:border-content focus:ring-1 focus:ring-content outline-none transition-colors"
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(0);
            }}
            aria-label={t("scans.startDate")}
            className="px-3 py-2 rounded-lg border border-line bg-surface text-content focus:border-content focus:ring-1 focus:ring-content outline-none transition-colors"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(0);
            }}
            aria-label={t("scans.endDate")}
            className="px-3 py-2 rounded-lg border border-line bg-surface text-content focus:border-content focus:ring-1 focus:ring-content outline-none transition-colors"
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm font-medium text-content-dim hover:text-content transition-colors"
            >
              {t("scans.clearFilters")}
            </button>
          )}
        </div>

        <div className="p-6">
          {loading && items.length === 0 && (
            <p className="text-center py-8 text-content-dim">
              {t("common:status.loading")}
            </p>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-danger">{t("scans.loadError")}</p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-sm text-info hover:text-info-strong"
              >
                {t("common:buttons.retry")}
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="text-center py-8">
              <p className="text-content-dim">
                {hasFilters ? t("scans.noSearchResults") : t("scans.noScans")}
              </p>
              {!hasFilters && (
                <>
                  <p className="mt-1 text-sm text-content-dim">
                    {t("scans.noScansDescription")}
                  </p>
                  {/* The global ScanFab also reaches the camera from here, but
                      an empty list needs a signpost, not just a floating icon. */}
                  <Link
                    href="/petition"
                    className="inline-block mt-4 px-6 py-3 bg-inverse-surface text-on-inverse rounded-lg font-medium no-underline hover:opacity-90 transition-opacity"
                  >
                    {t("scans.scanAgain")}
                  </Link>
                </>
              )}
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="divide-y divide-line">
                {items.map((item) => (
                  <ScanRow
                    key={item.id}
                    item={item}
                    onRequestDelete={setDeleteConfirmId}
                  />
                ))}
              </div>

              {/* `page > 0` keeps Previous reachable even if the total shrinks
                  below one page while the user is on a trailing page. */}
              {(total > PAGE_SIZE || page > 0) && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-line">
                  <p className="text-sm text-content-dim">
                    {t("scans.showing", {
                      from: page * PAGE_SIZE + 1,
                      to: Math.min((page + 1) * PAGE_SIZE, total),
                      total,
                    })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 text-sm font-medium text-content-dim bg-surface-alt rounded-lg hover:bg-surface-sunk disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("scans.previous")}
                    </button>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!hasMore}
                      className="px-3 py-1.5 text-sm font-medium text-content-dim bg-surface-alt rounded-lg hover:bg-surface-sunk disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("scans.next")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Destructive bulk action gets its own panel so it reads as deliberate,
          rather than sitting under the pagination as a stray link. */}
      {total > 0 && (
        <div className="bg-surface rounded-lg border border-line p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-content">
              {t("scans.deleteAllTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-content-dim">
              {t("scans.deleteAllDescription")}
            </p>
          </div>
          <button
            onClick={() => setDeleteAllConfirm(true)}
            className="px-4 py-2 text-sm font-medium text-danger hover:text-danger-strong hover:bg-danger-surface rounded-lg transition-colors"
          >
            {t("scans.deleteAllScans")}
          </button>
        </div>
      )}

      {deleteConfirmId && (
        <ConfirmDialog
          message={t("scans.deleteConfirm")}
          confirmLabel={t("scans.delete")}
          onConfirm={() => handleDelete(deleteConfirmId)}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      {deleteAllConfirm && (
        <ConfirmDialog
          message={t("scans.deleteAllConfirm")}
          confirmLabel={t("scans.deleteAllScans")}
          onConfirm={handleDeleteAll}
          onCancel={() => setDeleteAllConfirm(false)}
        />
      )}
    </div>
  );
}
