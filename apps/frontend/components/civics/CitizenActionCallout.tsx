"use client";

import type { CitizenAction } from "@/lib/graphql/region";

interface CitizenActionCalloutProps {
  action: CitizenAction | null | undefined;
}

const verbIcons: Record<string, string> = {
  comment: "💬",
  attend: "📅",
  contact: "✉️",
  monitor: "👁",
  vote: "🗳",
  learn: "📖",
};

/**
 * Displays the citizen-action CTA for the current lifecycle stage.
 * Active urgency: orange styling, prominent button.
 * Passive urgency: subdued gray, informational.
 * None: renders nothing.
 */
export function CitizenActionCallout({ action }: CitizenActionCalloutProps) {
  if (!action || action.urgency === "none") return null;

  const isActive = action.urgency === "active";
  const icon = verbIcons[action.verb] ?? "➡️";

  const content = (
    <>
      <span aria-hidden="true" className="text-lg">
        {icon}
      </span>
      <span className="font-medium">{action.label.plainLanguage}</span>
    </>
  );

  const baseClass = [
    "flex items-center gap-2 rounded-lg px-4 py-3 text-sm transition-colors",
    isActive
      ? "bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800"
      : "bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700",
  ].join(" ");

  // Defense-in-depth: only render the link if the URL is http(s).
  // The primary sanitization happens in the backend getCivicsData service,
  // but we guard here too in case of a schema change or direct API call.
  const safeUrl =
    action.url &&
    (action.url.startsWith("https://") || action.url.startsWith("http://"))
      ? action.url
      : null;

  if (safeUrl) {
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass}
        aria-label={`${action.label.plainLanguage} — opens in new tab`}
      >
        {content}
        <span aria-hidden="true" className="ml-auto text-xs opacity-60">
          ↗
        </span>
      </a>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
