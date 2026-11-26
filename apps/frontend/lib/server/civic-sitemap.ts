import type { MetadataRoute } from "next";
import { edgeQuery } from "./edge-read";

/**
 * The civic record's sitemaps (#1456): one per kind of page, with bills in
 * chunks.
 *
 * Split so no single sitemap needs more than ten reads of the gateway (the
 * list queries cap at 100 rows), which keeps a render well inside the
 * Worker's subrequest budget. Bill chunks are a fixed set rather than
 * counted, so `robots.txt` can list them without a read of its own; ten
 * chunks of 1,000 is twice today's 5,065 bills, and an empty chunk is a
 * valid, empty sitemap.
 *
 * Every read is edge-cached for a day. A failed read ends that sitemap
 * early, with what it has: a short sitemap, never an error.
 */

const PAGE_SIZE = 100;
/** Rows per sitemap: ten reads at most. */
const ROWS_PER_SITEMAP = 1_000;
const BILL_CHUNKS = 10;
const DAY_SECONDS = 86_400;

const billChunkIds = Array.from(
  { length: BILL_CHUNKS },
  (_, i) => `bills-${i}` as const,
);

export const CIVIC_SITEMAP_IDS = [
  "sections",
  "propositions",
  "representatives",
  "committees",
  ...billChunkIds,
] as const;

export type CivicSitemapId = (typeof CIVIC_SITEMAP_IDS)[number];

/**
 * The section pages worth a search result. Left out: the county and state
 * layers and search, which show a crawler nothing but a lookup form or an
 * empty query, and federal, which the map-first design no longer links.
 */
const SECTIONS = [
  "/region",
  "/region/propositions",
  "/region/bills",
  "/region/representatives",
  "/region/legislative-committees",
  "/region/meetings",
  "/region/campaign-finance",
  "/region/campaign-finance/committees",
  "/region/campaign-finance/contributions",
  "/region/campaign-finance/expenditures",
  "/region/campaign-finance/independent-expenditures",
  "/region/how-it-works",
];

interface Row {
  readonly id: string;
  readonly updatedAt?: string;
}

interface Kind {
  /** The query's root field. */
  readonly field: string;
  readonly query: string;
  readonly path: (id: string) => string;
}

const KINDS = {
  propositions: {
    field: "propositions",
    query:
      "query SitemapPropositions($skip: Int!, $take: Int!) { propositions(skip: $skip, take: $take) { items { id updatedAt } hasMore } }",
    path: (id) => `/region/propositions/${id}`,
  },
  representatives: {
    field: "representatives",
    query:
      "query SitemapRepresentatives($skip: Int!, $take: Int!) { representatives(skip: $skip, take: $take) { items { id updatedAt } hasMore } }",
    path: (id) => `/region/representatives/${id}`,
  },
  committees: {
    field: "legislativeCommittees",
    query:
      "query SitemapCommittees($skip: Int!, $take: Int!) { legislativeCommittees(skip: $skip, take: $take) { items { id } hasMore } }",
    path: (id) => `/region/legislative-committees/${id}`,
  },
  bills: {
    field: "bills",
    // Every bill, not just the active ones: a passed or dead bill is still
    // part of the record.
    query:
      "query SitemapBills($skip: Int!, $take: Int!) { bills(skip: $skip, take: $take, lifecycle: ALL) { items { id updatedAt } hasMore } }",
    path: (id) => `/region/bills/${id}`,
  },
} satisfies Record<string, Kind>;

type Query = typeof edgeQuery;

/** Rows `start` to `end` of one kind, a page at a time, stopping at a failure. */
async function collect(
  kind: Kind,
  start: number,
  end: number,
  query: Query,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let skip = start; skip < end; skip += PAGE_SIZE) {
    const data = await query<
      Record<string, { items: Row[]; hasMore: boolean }>
    >(
      kind.query,
      { skip, take: Math.min(PAGE_SIZE, end - skip) },
      { ttl: DAY_SECONDS },
    );
    const page = data?.[kind.field];
    if (!page) break;
    rows.push(...page.items);
    if (!page.hasMore) break;
  }
  return rows;
}

function rowsFor(id: string, query: Query): Promise<Row[]> | null {
  const chunk = /^bills-(\d+)$/.exec(id);
  if (chunk && Number(chunk[1]) < BILL_CHUNKS) {
    const start = Number(chunk[1]) * ROWS_PER_SITEMAP;
    return collect(KINDS.bills, start, start + ROWS_PER_SITEMAP, query);
  }
  if (
    id === "propositions" ||
    id === "representatives" ||
    id === "committees"
  ) {
    return collect(KINDS[id], 0, ROWS_PER_SITEMAP, query);
  }
  return null;
}

function kindOf(id: string): Kind {
  if (id.startsWith("bills-")) return KINDS.bills;
  return KINDS[id as "propositions" | "representatives" | "committees"];
}

export async function civicSitemap(
  id: string,
  deps: { readonly query?: Query; readonly baseUrl?: string } = {},
): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    deps.baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200";

  if (id === "sections") {
    return SECTIONS.map((path) => ({
      url: `${baseUrl}${path}`,
      changeFrequency: "daily",
      priority: path === "/region" ? 0.9 : 0.7,
    }));
  }

  const pending = rowsFor(id, deps.query ?? edgeQuery);
  if (!pending) return [];
  const kind = kindOf(id);
  return (await pending).map((row) => ({
    url: `${baseUrl}${kind.path(row.id)}`,
    ...(row.updatedAt ? { lastModified: row.updatedAt } : {}),
    changeFrequency: "weekly",
    priority: 0.6,
  }));
}
