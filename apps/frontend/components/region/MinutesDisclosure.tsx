"use client";

import { useId, useState } from "react";
import { useLazyQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";

import {
  GET_MINUTES,
  type IdVars,
  type Minutes,
  type MinutesData,
} from "@/lib/graphql/region";

import { ConcernsBadge } from "./ConcernsBadge";
import { MinutesClaims } from "./MinutesClaims";
import { MinutesSynopsis } from "./MinutesSynopsis";

/**
 * On-demand disclosure surfacing a session's AI synopsis + flagged concerns
 * (#932). Rendered from an `ActionCard` when the action carries a `minutesId`,
 * so it lands on both the committee "Recent activity" feed and the rep
 * activity view via the shared card. The `minutes(id)` query is lazy — it
 * fires only when the citizen expands — so a feed with dozens of actions
 * costs nothing until a row is opened (no N+1).
 */

function MinutesPanelBody({ minutes }: { readonly minutes: Minutes }) {
  const { t } = useTranslation("civics");
  const hasContent =
    Boolean(minutes.summary) || (minutes.claims?.length ?? 0) > 0;
  if (!hasContent) {
    return (
      <p className="text-sm text-slate-600 italic">
        {t("minutes.disclosure.empty")}
      </p>
    );
  }
  return (
    <>
      <ConcernsBadge claims={minutes.claims} />
      <MinutesSynopsis summary={minutes.summary} />
      <MinutesClaims claims={minutes.claims} />
    </>
  );
}

export function MinutesDisclosure({
  minutesId,
}: {
  readonly minutesId: string;
}) {
  const { t } = useTranslation("civics");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [load, { data, loading, error, called }] = useLazyQuery<
    MinutesData,
    IdVars
  >(GET_MINUTES);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Fetch on first expand; also re-fire after a failed load so the "Try
    // again" copy is actionable (a prior error leaves `called` true).
    if (next && (!called || error)) {
      void load({ variables: { id: minutesId } });
    }
  };

  const minutes = data?.minutes;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {open ? t("minutes.disclosure.hide") : t("minutes.disclosure.show")}
      </button>
      {/* Panel always present (with a stable id) so `aria-controls` resolves
          even while collapsed; `hidden` toggles visibility for AT + sighted. */}
      <div id={panelId} hidden={!open} className="mt-3 space-y-3">
        {open && loading && (
          <p className="text-sm text-content-dim italic">
            {t("minutes.disclosure.loading")}
          </p>
        )}
        {open && error && (
          <p className="text-sm text-red-700">
            {t("minutes.disclosure.error")}
          </p>
        )}
        {open && !loading && !error && minutes && (
          <MinutesPanelBody minutes={minutes} />
        )}
      </div>
    </div>
  );
}
