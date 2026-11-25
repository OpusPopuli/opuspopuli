import type { Metadata } from "next";
import { edgeQuery } from "./edge-read";

/**
 * Titles, descriptions and canonical URLs for the civic record's detail
 * pages (#1456), so a search result or a shared link says what the page is.
 *
 * The pages themselves are client components; a small server layout on each
 * `[id]` route calls {@link civicMetadata}. One light, public read per page,
 * edge-cached, with a timeout. When the read fails the page still gets a
 * generic title and its canonical URL, and stays indexable: a timeout is
 * transient. When the server answers that the record doesn't exist, the
 * page is marked noindex, since the client renders "not found" with a 200.
 */

export type CivicKind = "proposition" | "bill" | "representative" | "committee";

/** Six hours: titles rarely change, and a stale one corrects itself. */
const METADATA_TTL_SECONDS = 6 * 3_600;
const DESCRIPTION_MAX = 160;
/** Before the " | Opus Populi" suffix, which the root layout's template adds. */
const TITLE_MAX = 70;

interface Described {
  readonly title: string;
  readonly description?: string;
}

interface KindSpec {
  readonly path: string;
  readonly field: string;
  readonly query: string;
  readonly fallbackTitle: string;
  readonly describe: (row: Record<string, string | null>) => Described;
}

const SPECS: Record<CivicKind, KindSpec> = {
  proposition: {
    path: "/region/propositions",
    field: "proposition",
    query:
      "query PropositionMeta($id: ID!) { proposition(id: $id) { title summary analysisSummary } }",
    fallbackTitle: "Proposition",
    describe: (p) => ({
      title: p.title ?? "Proposition",
      description: p.analysisSummary ?? p.summary ?? undefined,
    }),
  },
  bill: {
    path: "/region/bills",
    field: "bill",
    query:
      "query BillMeta($id: ID!) { bill(id: $id) { billNumber title subject } }",
    fallbackTitle: "Bill",
    // A bill's title is its legal text ("An act to add Article 1.5 …"), so
    // the subject names it and the legal text describes it.
    describe: (b) => {
      const name = b.subject ?? snippet(b.title ?? undefined, TITLE_MAX);
      return {
        title: [b.billNumber, name].filter(Boolean).join(": ") || "Bill",
        description: b.title ?? undefined,
      };
    },
  },
  representative: {
    path: "/region/representatives",
    field: "representative",
    query:
      "query RepresentativeMeta($id: ID!) { representative(id: $id) { name chamber district party } }",
    fallbackTitle: "Representative",
    describe: (r) => ({
      title: r.name ?? "Representative",
      description: [
        r.chamber,
        r.district ? `District ${r.district}` : null,
        r.party,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
  },
  committee: {
    path: "/region/legislative-committees",
    field: "legislativeCommittee",
    query:
      "query CommitteeMeta($id: ID!) { legislativeCommittee(id: $id) { name chamber description } }",
    fallbackTitle: "Committee",
    describe: (c) => ({
      title: c.name ?? "Committee",
      description:
        c.description ?? (c.chamber ? `${c.chamber} committee` : undefined),
    }),
  },
};

/** One line, cut at a word near the limit: the length a result shows. */
export function snippet(
  text: string | undefined,
  max: number = DESCRIPTION_MAX,
): string | undefined {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)) || cut;
  return `${atWord}…`;
}

export async function civicMetadata(
  kind: CivicKind,
  id: string,
  query: typeof edgeQuery = edgeQuery,
): Promise<Metadata> {
  const spec = SPECS[kind];
  const canonical = `${spec.path}/${encodeURIComponent(id)}`;
  const data = await query<
    Record<string, Record<string, string | null> | null>
  >(spec.query, { id }, { ttl: METADATA_TTL_SECONDS });

  // The read failed: say what kind of page it is, and keep it indexable.
  if (!data) {
    return { title: spec.fallbackTitle, alternates: { canonical } };
  }

  const row = data[spec.field];
  if (!row) {
    return {
      title: spec.fallbackTitle,
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }

  const { title, description } = spec.describe(row);
  const summary = snippet(description);
  return {
    title,
    ...(summary ? { description: summary } : {}),
    alternates: { canonical },
    openGraph: {
      title,
      ...(summary ? { description: summary } : {}),
      url: canonical,
    },
  };
}
