"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  GET_MY_SCAN_HISTORY,
  SOFT_DELETE_SCAN,
  DELETE_ALL_MY_SCANS,
  type MyScanHistoryData,
  type SoftDeleteScanData,
  type DeleteAllMyScansData,
  type ScanHistoryItem,
} from "@/lib/graphql/documents";

const PAGE_SIZE = 10;

function getStatusStyle(item: ScanHistoryItem): {
  label: string;
  className: string;
} {
  if (item.status.includes("failed")) {
    return { label: "failed", className: "bg-red-900 text-red-300" };
  }
  if (item.hasAnalysis) {
    return { label: "analyzed", className: "bg-green-900 text-green-300" };
  }
  return { label: "pending", className: "bg-yellow-900 text-yellow-300" };
}

export default function PetitionHistoryPage() {
  const router = useRouter();
  const { t } = useTranslation("petition");

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

  // Debounce search
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null,
  );
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        setDebouncedSearch(value);
        setPage(0);
      }, 300);
      setDebounceTimer(timer);
    },
    [debounceTimer],
  );

  const filters = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
  const hasFilters = debouncedSearch || startDate || endDate;

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
    await softDeleteScan({ variables: { documentId } });
    setDeleteConfirmId(null);
    refetch();
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

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm px-4 py-4 flex items-center gap-3 border-b border-gray-800">
        <button
          onClick={() => router.push("/petition")}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label={t("results.back")}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-white">
          {t("history.title")}
        </h1>
      </div>

      {/* Search & Filters */}
      <div className="px-4 py-4 space-y-3 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("history.search")}
          className="w-full bg-gray-900 text-gray-200 rounded-lg px-4 py-3 text-sm border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none placeholder-gray-500"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(0);
            }}
            aria-label={t("history.startDate")}
            className="flex-1 bg-gray-900 text-gray-200 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(0);
            }}
            aria-label={t("history.endDate")}
            className="flex-1 bg-gray-900 text-gray-200 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
          />
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            {t("history.clearFilters")}
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <LoadingSpinner size="lg" className="text-blue-500 mb-4" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-8 text-center">
          <p className="text-red-400">{error.message}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <svg
            className="w-16 h-16 mb-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-lg font-semibold text-white mb-2">
            {hasFilters ? t("history.noSearchResults") : t("history.noScans")}
          </h2>
          {!hasFilters && (
            <p className="text-gray-400 mb-6">
              {t("history.noScansDescription")}
            </p>
          )}
          <Link
            href="/petition"
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t("history.scanAgain")}
          </Link>
        </div>
      )}

      {/* Scan List */}
      {items.length > 0 && (
        <div className="px-4 py-4 space-y-3">
          {items.map((item) => {
            const status = getStatusStyle(item);
            return (
              <div key={item.id} className="relative">
                <Link
                  href={`/petition/history/${item.id}`}
                  className="block bg-gray-900 hover:bg-gray-800 rounded-lg p-4 transition-colors border border-gray-800"
                  aria-label={t("history.viewDetail")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">
                        {item.summary || item.type}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${status.className}`}
                        >
                          {t(`history.${status.label}`)}
                        </span>
                        {item.ocrConfidence != null && (
                          <span className="text-xs text-gray-500">
                            {item.ocrConfidence.toFixed(0)}%{" "}
                            {t("results.confidence")}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-500 flex-shrink-0 mt-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Link>
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleteConfirmId(item.id);
                  }}
                  className="absolute top-3 right-10 text-gray-600 hover:text-red-400 transition-colors p-1"
                  aria-label={t("history.deleteScan")}
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
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="px-4 py-4 flex items-center justify-between border-t border-gray-800">
          <p className="text-sm text-gray-500">
            {t("history.showing", {
              from: page * PAGE_SIZE + 1,
              to: Math.min((page + 1) * PAGE_SIZE, total),
              total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("history.previous")}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("history.next")}
            </button>
          </div>
        </div>
      )}

      {/* Delete All */}
      {total > 0 && (
        <div className="px-4 pb-6 flex justify-center">
          <button
            onClick={() => setDeleteAllConfirm(true)}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            {t("history.deleteAllScans")}
          </button>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full border border-gray-700">
            <p className="text-white mb-6">{t("history.deleteConfirm")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                {t("results.back")}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {t("history.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirm Dialog */}
      {deleteAllConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full border border-gray-700">
            <p className="text-white mb-6">{t("history.deleteAllConfirm")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteAllConfirm(false)}
                className="flex-1 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                {t("results.back")}
              </button>
              <button
                onClick={handleDeleteAll}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {t("history.deleteAllScans")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
