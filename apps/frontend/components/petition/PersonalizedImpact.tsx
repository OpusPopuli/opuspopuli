"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import type { PersonalizedImpactState } from "./usePersonalizedImpact";

/**
 * The "What this means to you" block that LEADS the scan results (#1052) —
 * rendered above the match hero and generic analysis. Absent state renders
 * nothing: the generic analysis below is always the fallback.
 *
 * bg-ink + text-paper/accent are FIXED tokens (never theme-flip), matching
 * the match hero in AnalysisDisplay — theme-relative tokens can invert to
 * light on this pinned-dark surface and fail contrast (#1047).
 *
 * The loading→ready swap happens inside ONE persistent aria-live="polite"
 * section, so screen readers announce the read when it lands late — a
 * replaced element would drop the announcement.
 */
export function PersonalizedImpact({
  status,
  impact,
}: PersonalizedImpactState) {
  const { t } = useTranslation("petition");

  if (status === "absent") return null;

  if (status === "anonymous") {
    return (
      <section
        aria-labelledby="personalized-impact-signin"
        className="rounded-2xl bg-ink ring-1 ring-paper/20 p-5"
      >
        <h2
          id="personalized-impact-signin"
          className="text-base font-semibold text-paper"
        >
          {t("results.personalizedSignInTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-content-dim">
          {t("results.personalizedSignInBody")}
        </p>
        <Link
          href="/login"
          className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
        >
          {t("results.personalizedSignInCta")}
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      className={`relative overflow-hidden rounded-2xl bg-ink ring-1 p-5 ${
        status === "ready" ? "ring-accent/40" : "ring-paper/20"
      }`}
    >
      {status === "loading" ? (
        <div role="status" className="flex items-center gap-3">
          <LoadingSpinner size="sm" className="text-accent" />
          <p className="text-sm text-content-dim">
            {t("results.personalizedLoading")}
          </p>
        </div>
      ) : (
        <>
          <span
            className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/10"
            aria-hidden="true"
          />
          <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <span aria-hidden="true">&#10022;</span>
            {t("results.personalizedTitle")}
          </h2>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-paper">
            {impact?.text}
          </p>
          <p className="mt-3 text-xs text-content-dim">
            {t("results.personalizedAiLabel")}
            {impact?.provider && impact?.model
              ? ` · ${t("results.analyzedBy", {
                  provider: impact.provider,
                  model: impact.model,
                })}`
              : null}
          </p>
        </>
      )}
    </section>
  );
}
