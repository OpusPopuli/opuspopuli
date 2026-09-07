import { SNIPPET_START, SNIPPET_END } from "@/lib/graphql/region";

/**
 * Renders a ts_headline snippet from regionSearch (#1154).
 *
 * The string is a slice of SCRAPED SOURCE TEXT and may contain HTML
 * fragments — the backend contract (region-search.model.ts) is explicit
 * that the ⟪⟫ markers make highlighting possible *without* HTML, not
 * that the payload is safe for innerHTML. So this component splits on
 * the markers and renders every segment as a React text node; nothing
 * here may ever grow a dangerouslySetInnerHTML.
 */
export function SnippetText({ text }: { readonly text: string }) {
  const segments: { marked: boolean; text: string }[] = [];
  const chunks = text.split(SNIPPET_START);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i === 0) {
      if (chunk) segments.push({ marked: false, text: chunk });
      continue;
    }
    const endIdx = chunk.indexOf(SNIPPET_END);
    if (endIdx === -1) {
      // Unbalanced marker (shouldn't happen) — render as plain text.
      segments.push({ marked: false, text: chunk });
      continue;
    }
    const marked = chunk.slice(0, endIdx);
    const rest = chunk.slice(endIdx + SNIPPET_END.length);
    if (marked) segments.push({ marked: true, text: marked });
    if (rest) segments.push({ marked: false, text: rest });
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.marked ? (
          <mark
            // eslint-disable-next-line react/no-array-index-key -- static list, render-only
            key={i}
            // text-content, NOT inherit: snippets render in text-content-dim,
            // and dim-on-gold-tint measures 4.33:1 — under the 4.5:1 AA floor
            // (caught by the axe e2e scan). Ink on the tint clears it easily,
            // and a highlight should read stronger than its surroundings.
            className="rounded-[2px] bg-accent/35 px-px font-medium text-content"
          >
            {seg.text}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- static list, render-only
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
