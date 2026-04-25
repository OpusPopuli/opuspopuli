"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SectionTitle } from "@/components/region/SectionTitle";
import type {
  PropositionAnalysisClaim,
  PropositionAnalysisSection,
} from "@/lib/graphql/region";
import { claimAnchorId } from "@/components/region/ClaimAttribution";

/**
 * Deep-Dive renderer for the raw proposition fullText, driven by the
 * AI-segmented sections returned by the analyzer. Each section is a
 * collapsible block; a sticky sidebar (desktop) / top picker (mobile)
 * jumps between sections.
 *
 * Claim passages are highlighted inline using char-offset ranges from
 * analysisClaims, and each highlight gets an anchor id so clicks from
 * ClaimAttribution footnotes in other layers can scroll the reader here.
 *
 * If analysisSections is empty we fall back to rendering the full text
 * as a single "Full Text" section so the feature degrades gracefully
 * when the analyzer hasn't run yet.
 */
export function SegmentedFullText({
  fullText,
  sections,
  claims,
  focusedClaimKey,
}: {
  readonly fullText: string;
  readonly sections: PropositionAnalysisSection[];
  readonly claims: PropositionAnalysisClaim[];
  /**
   * When set, the corresponding section auto-expands and the anchor is
   * scrolled into view. Updated by the parent when the user clicks a
   * ClaimAttribution footnote in Layer 2.
   */
  readonly focusedClaimKey?: string;
}) {
  const effectiveSections = useMemo<PropositionAnalysisSection[]>(() => {
    if (sections.length === 0) {
      return [
        {
          heading: "Full Text",
          startOffset: 0,
          endOffset: fullText.length,
        },
      ];
    }
    // Defensive: backend-side normalizeSections() already snaps offsets
    // to fullText, but legacy DB rows written before that fix may still
    // have inter-section gaps and a missing leading preamble. Re-snap
    // here so the UI never drops a character regardless of source.
    return normalizeSectionsForRender(sections, fullText);
  }, [sections, fullText]);

  // Sections the user has explicitly toggled. Initial set: everything if
  // small enough to comfortably show open, else just the first.
  const [userExpanded, setUserExpanded] = useState<Set<number>>(
    () =>
      new Set(
        effectiveSections.length <= 3
          ? effectiveSections.map((_, i) => i)
          : [0],
      ),
  );

  // Section index implied by the focused claim (if any). Derived during
  // render — never written to state — so we don't trip
  // react-hooks/set-state-in-effect when the parent navigates here from
  // a Layer-2 footnote click.
  const focusedSectionIdx = useMemo<number | null>(() => {
    if (!focusedClaimKey) return null;
    const claim = claims.find(
      (c) => `${c.sourceStart}-${c.sourceEnd}` === focusedClaimKey,
    );
    if (!claim) return null;
    const idx = effectiveSections.findIndex(
      (s) =>
        claim.sourceStart >= s.startOffset && claim.sourceStart < s.endOffset,
    );
    return idx === -1 ? null : idx;
  }, [focusedClaimKey, claims, effectiveSections]);

  const expanded = useMemo<Set<number>>(() => {
    if (focusedSectionIdx === null) return userExpanded;
    const next = new Set(userExpanded);
    next.add(focusedSectionIdx);
    return next;
  }, [userExpanded, focusedSectionIdx]);

  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll to the focused claim's anchor once after the focus changes.
  // Pure side effect — no setState — so the lint rule stays happy.
  useEffect(() => {
    if (!focusedClaimKey) return;
    const claim = claims.find(
      (c) => `${c.sourceStart}-${c.sourceEnd}` === focusedClaimKey,
    );
    if (!claim) return;
    queueMicrotask(() => {
      const anchor = document.getElementById(claimAnchorId(claim));
      anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusedClaimKey, claims]);

  function toggle(idx: number) {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function jumpTo(idx: number) {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    queueMicrotask(() => {
      sectionRefs.current[idx]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
      <TableOfContents sections={effectiveSections} onJump={jumpTo} />
      <div>
        <SectionTitle>Full Proposition Text</SectionTitle>
        <div className="space-y-3">
          {effectiveSections.map((section, idx) => (
            <div
              key={`${section.startOffset}-${section.endOffset}`}
              ref={(el) => {
                sectionRefs.current[idx] = el;
              }}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggle(idx)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-sm font-semibold text-[#222222]">
                  {section.heading}
                </span>
                <span className="text-xs text-slate-500">
                  {expanded.has(idx) ? "Hide" : "Show"}
                </span>
              </button>
              {expanded.has(idx) && (
                <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                  <SectionBody
                    fullText={fullText}
                    section={section}
                    claims={claims}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TableOfContents({
  sections,
  onJump,
}: {
  readonly sections: PropositionAnalysisSection[];
  readonly onJump: (idx: number) => void;
}) {
  return (
    <nav
      aria-label="Proposition text sections"
      className="md:sticky md:top-6 self-start bg-[#fafafa] border border-gray-200 rounded-xl p-4 text-sm"
    >
      <p className="text-xs uppercase tracking-[1.5px] font-bold text-[#595959] mb-2">
        Sections
      </p>
      <ol className="space-y-1">
        {sections.map((section, idx) => (
          <li key={`${section.startOffset}-${section.endOffset}`}>
            <button
              type="button"
              onClick={() => onJump(idx)}
              className="text-left text-blue-600 hover:underline text-sm leading-snug"
            >
              {idx + 1}. {section.heading}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Render a section's slice of fullText with inline <mark> highlights for
 * every claim whose source range overlaps this section. Each highlight
 * gets a stable anchor id so ClaimAttribution footnotes can scroll here.
 */
function SectionBody({
  fullText,
  section,
  claims,
}: {
  readonly fullText: string;
  readonly section: PropositionAnalysisSection;
  readonly claims: PropositionAnalysisClaim[];
}) {
  const sectionClaims = claims.filter(
    (c) =>
      c.sourceStart < section.endOffset && c.sourceEnd > section.startOffset,
  );

  if (sectionClaims.length === 0) {
    return (
      <p className="text-sm text-[#334155] leading-relaxed whitespace-pre-line">
        {fullText.slice(section.startOffset, section.endOffset)}
      </p>
    );
  }

  const segments = buildHighlightedSegments(fullText, section, sectionClaims);

  return (
    <p className="text-sm text-[#334155] leading-relaxed whitespace-pre-line">
      {segments.map((seg, i) =>
        seg.claim ? (
          <mark
            key={i}
            id={claimAnchorId(seg.claim)}
            className="bg-yellow-100 rounded px-0.5 -mx-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Split the section's text into a flat list of plain + highlighted
 * segments. Non-overlapping: when two claims overlap, the later one
 * wins for the overlapping range. Simple enough for the expected claim
 * count (typically < 10 per section) and avoids a nested-span pyramid.
 */
function buildHighlightedSegments(
  fullText: string,
  section: PropositionAnalysisSection,
  claims: PropositionAnalysisClaim[],
): { text: string; claim?: PropositionAnalysisClaim }[] {
  const sorted = [...claims].sort((a, b) => a.sourceStart - b.sourceStart);
  const segments: { text: string; claim?: PropositionAnalysisClaim }[] = [];
  let cursor = section.startOffset;

  for (const claim of sorted) {
    const start = Math.max(claim.sourceStart, section.startOffset);
    const end = Math.min(claim.sourceEnd, section.endOffset);
    if (end <= cursor) continue; // fully before the cursor — skip
    if (start > cursor) {
      segments.push({ text: fullText.slice(cursor, start) });
    }
    segments.push({
      text: fullText.slice(Math.max(start, cursor), end),
      claim,
    });
    cursor = end;
  }
  if (cursor < section.endOffset) {
    segments.push({ text: fullText.slice(cursor, section.endOffset) });
  }
  return segments;
}

/**
 * Defensively snap section boundaries against the actual fullText so the
 * rendered output never drops characters. Mirrors the backend's
 * normalizeSections() — kept here as a "belt and suspenders" guard for
 * legacy DB rows written before the backend snap was added.
 *
 * - Snap each section's start to the heading's verbatim location in
 *   fullText (when found).
 * - Force section[0] to start at offset 0 so any leading preamble is
 *   included.
 * - Each section ends at the next section's start (last section ends at
 *   fullText.length) — guarantees no inter-section gap.
 */
function normalizeSectionsForRender(
  raw: PropositionAnalysisSection[],
  fullText: string,
): PropositionAnalysisSection[] {
  const textLen = fullText.length;
  if (raw.length === 0 || textLen === 0) return raw;

  const clamp = (n: number) =>
    Math.max(0, Math.min(textLen, Math.floor(Number.isFinite(n) ? n : 0)));

  let searchFrom = 0;
  const snapped = raw.map((s) => {
    const heading = s.heading?.trim() ?? "";
    const idx = heading ? fullText.indexOf(heading, searchFrom) : -1;
    const resolvedStart = idx >= 0 ? idx : clamp(s.startOffset);
    searchFrom = Math.max(searchFrom, resolvedStart + 1);
    return {
      heading: s.heading,
      startOffset: resolvedStart,
      endOffset: clamp(s.endOffset),
    };
  });

  snapped.sort((a, b) => a.startOffset - b.startOffset);
  snapped[0].startOffset = 0;
  for (let i = 0; i < snapped.length - 1; i++) {
    snapped[i].endOffset = snapped[i + 1].startOffset;
  }
  snapped[snapped.length - 1].endOffset = textLen;

  return snapped.filter((s) => s.endOffset > s.startOffset);
}
