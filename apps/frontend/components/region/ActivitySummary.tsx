"use client";

/**
 * AI-generated activity summary card. Renders at the top of Layer 3
 * on the rep + committee detail pages to give a low-info voter a
 * 2-3 sentence narrative of what the entity has been doing,
 * grounded in the structured action records the linker produces.
 *
 * Carries the same "AI-generated" affordance treatment as the
 * existing rep bio so users always know which content is
 * deterministic vs. machine-summarized. Provenance footer shows the
 * window and the generated-at timestamp.
 *
 * Issue #665.
 */

interface Props {
  readonly summary?: string;
  readonly generatedAt?: string;
  readonly windowDays?: number;
}

export function ActivitySummary({ summary, generatedAt, windowDays }: Props) {
  if (!summary || summary.trim().length === 0) return null;

  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <section
      aria-label="Recent activity summary"
      className="mb-6 bg-amber-50/40 border border-amber-200 rounded-lg p-5"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          AI-generated
        </span>
        <span className="text-[11px] uppercase tracking-wider font-bold text-[#595959]">
          Recent activity at a glance
        </span>
      </div>
      <p className="text-[#334155] leading-relaxed whitespace-pre-line">
        {summary}
      </p>
      {(generatedLabel || windowDays) && (
        <p className="mt-3 text-[11px] text-[#94a3b8] italic">
          Generated{generatedLabel ? ` ${generatedLabel}` : ""}
          {windowDays ? ` over the last ${windowDays} days` : ""}. May contain
          inaccuracies — verify against source records before citing.
        </p>
      )}
    </section>
  );
}
