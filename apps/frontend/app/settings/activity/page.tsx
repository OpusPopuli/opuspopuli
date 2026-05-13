"use client";

import { useState, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@apollo/client/react";
import {
  GET_MY_ACTIVITY_LOG,
  GET_MY_ACTIVITY_SUMMARY,
  GET_MY_SESSIONS,
  REVOKE_SESSION,
  REVOKE_ALL_OTHER_SESSIONS,
  MyActivityLogData,
  MyActivityLogVars,
  MyActivitySummaryData,
  MySessionsData,
  RevokeSessionData,
  RevokeSessionVars,
  RevokeAllOtherSessionsData,
  ActivityLogEntry,
  SessionInfo,
  AuditAction,
} from "@/lib/graphql/activity";
import { useToast } from "@/lib/toast";

const PAGE_SIZE = 10;

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

// Action types that should display with blue styling (update-related actions)
const BLUE_ACTIONS: AuditAction[] = [
  "UPDATE",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
]; // NOSONAR - These are enum values, not secrets

function getActionColor(action: AuditAction, success: boolean): string {
  if (!success) return "text-red-600 bg-red-50";

  switch (action) {
    case "LOGIN":
    case "CREATE":
      return "text-green-600 bg-green-50";
    case "LOGOUT":
    case "DELETE":
      return "text-orange-600 bg-orange-50";
    case "LOGIN_FAILED":
      return "text-red-600 bg-red-50";
    default:
      if (BLUE_ACTIONS.includes(action)) {
        return "text-blue-600 bg-blue-50";
      }
      return "text-gray-600 bg-gray-50";
  }
}

// Map action enums to i18n translation keys
// NOSONAR - PASSWORD_CHANGE and PASSWORD_RESET are enum values from the backend, not secrets
const actionTranslationKeys: Record<AuditAction, string> = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  PASSWORD_CHANGE: "CREDENTIAL_CHANGE",
  PASSWORD_RESET: "CREDENTIAL_RESET",
  CREATE: "CREATE",
  READ: "READ",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  BULK_READ: "BULK_READ",
  BULK_UPDATE: "BULK_UPDATE",
  BULK_DELETE: "BULK_DELETE",
  UPLOAD: "UPLOAD",
  DOWNLOAD: "DOWNLOAD",
  SEARCH: "SEARCH",
  EXPORT: "EXPORT",
};

function DeviceIcon({ deviceType }: { deviceType?: string }) {
  if (deviceType === "mobile") {
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
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    );
  }
  if (deviceType === "tablet") {
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
          d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    );
  }
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
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function ActivityLogItem({ entry }: { entry: ActivityLogEntry }) {
  const { t } = useTranslation("settings");
  const colorClasses = getActionColor(entry.action, entry.success);
  const translationKey = actionTranslationKeys[entry.action];

  return (
    <div className="flex items-start gap-4 py-4 border-b border-gray-100 last:border-0">
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${colorClasses}`}
      >
        <DeviceIcon deviceType={entry.deviceType} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-gray-900">
            {t(`activity.actions.${translationKey}`)}
            {entry.entityType && (
              <span className="text-gray-500 font-normal">
                {" "}
                {entry.entityType.toLowerCase()}
              </span>
            )}
          </p>
          <span className="text-sm text-gray-500 flex-shrink-0">
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
          {entry.browser && <span>{entry.browser}</span>}
          {entry.browser && entry.ipAddress && <span>•</span>}
          {entry.ipAddress && <span>{entry.ipAddress}</span>}
        </div>
        {!entry.success && entry.errorMessage && (
          <p className="mt-1 text-sm text-red-600">{entry.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onRevoke,
  isRevoking,
}: {
  session: SessionInfo;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}) {
  const { t } = useTranslation("settings");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const handleRevoke = () => {
    if (confirmRevoke) {
      onRevoke(session.id);
      setConfirmRevoke(false);
    } else {
      setConfirmRevoke(true);
    }
  };

  const location = [session.city, session.region, session.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`p-4 rounded-lg border ${session.isCurrent ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex-shrink-0 p-2 rounded-lg ${session.isCurrent ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"}`}
          >
            <DeviceIcon deviceType={session.deviceType} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-900">
                {session.deviceName || t("activity.sessions.unknownDevice")}
              </p>
              {session.isCurrent && (
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("activity.sessions.current")}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {session.browser} • {session.operatingSystem}
            </p>
            {location && <p className="text-sm text-gray-500">{location}</p>}
            <p className="text-sm text-gray-400 mt-1">
              {session.lastActivityAt
                ? t("activity.sessions.lastActive", {
                    time: formatRelativeTime(session.lastActivityAt),
                  })
                : t("activity.sessions.createdAt", {
                    time: formatDate(session.createdAt),
                  })}
            </p>
          </div>
        </div>
        {!session.isCurrent && session.isActive && (
          <div>
            {confirmRevoke ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmRevoke(false)}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800"
                  disabled={isRevoking}
                >
                  {t("common:buttons.cancel")}
                </button>
                <button
                  onClick={handleRevoke}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                  disabled={isRevoking}
                >
                  {isRevoking
                    ? t("common:buttons.loading")
                    : t("common:buttons.confirm")}
                </button>
              </div>
            ) : (
              <button
                onClick={handleRevoke}
                className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg"
              >
                {t("activity.sessions.revoke")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shared loading/error/empty states for ActivityTab and SessionsTab.
 * Returns a node when the tab should show a placeholder, or null to proceed
 * with rendering the actual content.
 */
function useTabPlaceholder(
  loading: boolean,
  error: unknown,
  emptyCheck: boolean,
  loadingText: string,
  errorText: string,
  emptyText: string,
  onRetry: () => void,
): ReactNode | null {
  const { t } = useTranslation(["common"]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">{loadingText}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">{errorText}</p>
        <button
          onClick={onRetry}
          className="mt-2 text-sm text-blue-600 hover:text-blue-700"
        >
          {t("common:buttons.retry")}
        </button>
      </div>
    );
  }
  if (emptyCheck) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">{emptyText}</p>
      </div>
    );
  }
  return null;
}

interface ActivityTabProps {
  loading: boolean;
  error: unknown;
  activityLog: MyActivityLogData["myActivityLog"] | undefined;
  offset: number;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function ActivityTab({
  loading,
  error,
  activityLog,
  offset,
  onRetry,
  onPrev,
  onNext,
}: ActivityTabProps) {
  const { t } = useTranslation(["settings", "common"]);
  const placeholder = useTabPlaceholder(
    loading,
    error,
    activityLog?.items.length === 0,
    t("common:status.loading"),
    t("activity.loadError"),
    t("activity.noActivity"),
    onRetry,
  );
  if (placeholder) return <>{placeholder}</>;

  return (
    <>
      <div className="divide-y divide-gray-100">
        {activityLog?.items.map((entry) => (
          <ActivityLogItem key={entry.id} entry={entry} />
        ))}
      </div>

      {/* Pagination */}
      {activityLog && activityLog.total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            {t("activity.showing", {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, activityLog.total),
              total: activityLog.total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onPrev}
              disabled={offset === 0}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("activity.previous")}
            </button>
            <button
              onClick={onNext}
              disabled={!activityLog.hasMore}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("activity.next")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface SessionsTabProps {
  loading: boolean;
  error: unknown;
  sessions: MySessionsData["mySessions"] | undefined;
  revokeAllLoading: boolean;
  revokeLoading: boolean;
  onRevokeAll: () => void;
  onRevokeSession: (id: string) => void;
  onRetry: () => void;
}

function SessionsTab({
  loading,
  error,
  sessions,
  revokeAllLoading,
  revokeLoading,
  onRevokeAll,
  onRevokeSession,
  onRetry,
}: SessionsTabProps) {
  const { t } = useTranslation(["settings", "common"]);
  const placeholder = useTabPlaceholder(
    loading,
    error,
    sessions?.items.length === 0,
    t("common:status.loading"),
    t("activity.loadError"),
    t("activity.noSessions"),
    onRetry,
  );
  if (placeholder) return <>{placeholder}</>;

  return (
    <>
      {/* Revoke all button */}
      {sessions && sessions.total > 1 && (
        <div className="flex justify-end mb-4">
          <button
            onClick={onRevokeAll}
            disabled={revokeAllLoading}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg disabled:opacity-50"
          >
            {revokeAllLoading
              ? t("common:buttons.loading")
              : t("activity.sessions.revokeAll")}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {sessions?.items.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onRevoke={onRevokeSession}
            isRevoking={revokeLoading}
          />
        ))}
      </div>
    </>
  );
}

function formatSuccessRate(
  summaryLoading: boolean,
  totalActions: number | undefined,
  successfulActions: number | undefined,
): string {
  if (summaryLoading) return "...";
  if (!totalActions) return "0%";
  return `${Math.round(((successfulActions ?? 0) / totalActions) * 100)}%`;
}

function formatLastLogin(
  summaryLoading: boolean,
  lastLoginAt: string | undefined,
  neverLabel: string,
): string {
  if (summaryLoading) return "...";
  if (lastLoginAt) return formatRelativeTime(lastLoginAt);
  return neverLabel;
}

export default function ActivityPage() {
  const { t } = useTranslation(["settings", "common"]);
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"activity" | "sessions">(
    "activity",
  );
  const [offset, setOffset] = useState(0);

  // Activity log query
  const {
    data: activityData,
    loading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useQuery<MyActivityLogData, MyActivityLogVars>(GET_MY_ACTIVITY_LOG, {
    variables: { limit: PAGE_SIZE, offset },
    skip: activeTab !== "activity",
  });

  // Activity summary query
  const { data: summaryData, loading: summaryLoading } =
    useQuery<MyActivitySummaryData>(GET_MY_ACTIVITY_SUMMARY);

  // Sessions query
  const {
    data: sessionsData,
    loading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery<MySessionsData>(GET_MY_SESSIONS, {
    variables: { includeRevoked: false },
    skip: activeTab !== "sessions",
  });

  // Revoke session mutation
  const [revokeSession, { loading: revokeLoading }] = useMutation<
    RevokeSessionData,
    RevokeSessionVars
  >(REVOKE_SESSION, {
    onCompleted: () => {
      showToast(t("activity.sessions.revokeSuccess"), "success");
      refetchSessions();
    },
    onError: (error) => {
      showToast(error.message, "error");
    },
  });

  // Revoke all sessions mutation
  const [revokeAllSessions, { loading: revokeAllLoading }] =
    useMutation<RevokeAllOtherSessionsData>(REVOKE_ALL_OTHER_SESSIONS, {
      onCompleted: (data) => {
        showToast(
          t("activity.sessions.revokeAllSuccess", {
            count: data.revokeAllOtherSessions,
          }),
          "success",
        );
        refetchSessions();
      },
      onError: (error) => {
        showToast(error.message, "error");
      },
    });

  const handleRevokeSession = (id: string) => {
    revokeSession({ variables: { id } });
  };

  const handleRevokeAllSessions = () => {
    if (confirm(t("activity.sessions.revokeAllConfirm"))) {
      revokeAllSessions();
    }
  };

  const summary = summaryData?.myActivitySummary;
  const activityLog = activityData?.myActivityLog;
  const sessions = sessionsData?.mySessions;

  const tabButtonClass = (tab: "activity" | "sessions") =>
    `px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-blue-500 text-blue-600"
        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t("activity.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t("activity.subtitle")}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">
            {t("activity.summary.totalActions")}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {summaryLoading ? "..." : (summary?.totalActions ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">
            {t("activity.summary.successRate")}
          </p>
          <p className="mt-1 text-2xl font-semibold text-green-600">
            {formatSuccessRate(
              summaryLoading,
              summary?.totalActions,
              summary?.successfulActions,
            )}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">
            {t("activity.summary.activeSessions")}
          </p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">
            {summaryLoading ? "..." : (summary?.activeSessions ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">
            {t("activity.summary.lastLogin")}
          </p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatLastLogin(
              summaryLoading,
              summary?.lastLoginAt,
              t("activity.summary.never"),
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => {
                setActiveTab("activity");
                setOffset(0);
              }}
              className={tabButtonClass("activity")}
            >
              {t("activity.tabs.activity")}
            </button>
            <button
              onClick={() => setActiveTab("sessions")}
              className={tabButtonClass("sessions")}
            >
              {t("activity.tabs.sessions")}
              {sessions && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  {sessions.total}
                </span>
              )}
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === "activity" && (
            <ActivityTab
              loading={activityLoading}
              error={activityError}
              activityLog={activityLog}
              offset={offset}
              onRetry={refetchActivity}
              onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}

          {activeTab === "sessions" && (
            <SessionsTab
              loading={sessionsLoading}
              error={sessionsError}
              sessions={sessions}
              revokeAllLoading={revokeAllLoading}
              revokeLoading={revokeLoading}
              onRevokeAll={handleRevokeAllSessions}
              onRevokeSession={handleRevokeSession}
              onRetry={refetchSessions}
            />
          )}
        </div>
      </div>
    </div>
  );
}
