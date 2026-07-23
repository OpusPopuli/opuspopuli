"use client";

import { useTranslation } from "react-i18next";

import type { MinutesSummaryClaim } from "@/lib/graphql/region";

import { ClaimKindBadge, ClaimSeverityTag } from "./ClaimBadges";

/**
 * Per-claim attribution list for a minutes synopsis (#932). Mirrors the
 * `BioClaims` treatment on the rep page: each row shows a kind badge, an
 * optional severity tag, the plain-language title + detail, the verbatim
 * citation quote, and any referenced bills. `billRefs` are external bill
 * identifiers (e.g. "AB 1234") rendered as chips — clickable links await a
 * resolve-by-externalId path (fast-follow).
 */

function ClaimRow({
  claim,
  billsLabel,
}: {
  readonly claim: MinutesSummaryClaim;
  readonly billsLabel: string;
}) {
  return (
    <li className="text-sm border-l-2 border-line pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <ClaimKindBadge kind={claim.kind} />
        {claim.severity && <ClaimSeverityTag severity={claim.severity} />}
        <span className="font-medium text-content">{claim.title}</span>
      </div>
      {claim.detail && (
        <p className="mt-1 text-content-dim leading-relaxed">{claim.detail}</p>
      )}
      {claim.citation?.quote && (
        <blockquote className="mt-1.5 border-l-2 border-amber-200 pl-2 text-[13px] italic text-slate-600">
          &ldquo;{claim.citation.quote}&rdquo;
          {claim.citation.pageHint && (
            <span className="not-italic text-slate-500">
              {" "}
              — {claim.citation.pageHint}
            </span>
          )}
        </blockquote>
      )}
      {claim.billRefs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            {billsLabel}
          </span>
          {claim.billRefs.map((ref) => (
            <span
              key={ref}
              className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
            >
              {ref}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function MinutesClaims({
  claims,
}: {
  readonly claims?: readonly MinutesSummaryClaim[];
}) {
  const { t } = useTranslation("civics");
  if (!claims || claims.length === 0) {
    return (
      <p className="text-sm text-slate-600 italic">
        {t("minutes.claims.empty")}
      </p>
    );
  }
  const billsLabel = t("minutes.claims.billRefsLabel");
  return (
    <ol className="space-y-3">
      {claims.map((claim, idx) => (
        <ClaimRow
          key={`${claim.kind}-${idx}-${claim.title}`}
          claim={claim}
          billsLabel={billsLabel}
        />
      ))}
    </ol>
  );
}
