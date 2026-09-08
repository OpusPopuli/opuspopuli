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

interface Segment {
  /** Character offset in the source string — a stable, unique key. */
  readonly offset: number;
  readonly marked: boolean;
  readonly text: string;
}

function toSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const chunks = text.split(SNIPPET_START);
  let offset = 0;

  const push = (marked: boolean, value: string) => {
    if (value) segments.push({ offset, marked, text: value });
    offset += value.length;
  };

  chunks.forEach((chunk, i) => {
    if (i === 0) {
      push(false, chunk);
      return;
    }
    offset += SNIPPET_START.length;
    const endIdx = chunk.indexOf(SNIPPET_END);
    if (endIdx === -1) {
      // Unbalanced marker (shouldn't happen) — render as plain text.
      push(false, chunk);
      return;
    }
    push(true, chunk.slice(0, endIdx));
    offset += SNIPPET_END.length;
    push(false, chunk.slice(endIdx + SNIPPET_END.length));
  });

  return segments;
}

export function SnippetText({ text }: { readonly text: string }) {
  return (
    <>
      {toSegments(text).map((seg) =>
        seg.marked ? (
          <mark
            key={seg.offset}
            // text-content, NOT inherit: snippets render in text-content-dim,
            // and dim-on-gold-tint measures 4.33:1 — under the 4.5:1 AA floor
            // (caught by the axe e2e scan). Ink on the tint clears it easily,
            // and a highlight should read stronger than its surroundings.
            className="rounded-[2px] bg-accent/35 px-px font-medium text-content"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={seg.offset}>{seg.text}</span>
        ),
      )}
    </>
  );
}
