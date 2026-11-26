/**
 * The civic record's sitemaps (#1456).
 */
import { CIVIC_SITEMAP_IDS, civicSitemap } from "@/lib/server/civic-sitemap";
import type { edgeQuery } from "@/lib/server/edge-read";

const BASE = "https://california.example.org";

type Vars = { skip: number; take: number };

/** A fake gateway holding `total` rows of one kind. */
function gateway(field: string, total: number, failAtSkip?: number) {
  return jest.fn(
    async (_query: string, variables?: Record<string, unknown>) => {
      const { skip, take } = variables as Vars;
      if (skip === failAtSkip) return null;
      const items = Array.from(
        { length: Math.max(0, Math.min(take, total - skip)) },
        (_, i) => ({ id: `id-${skip + i}`, updatedAt: "2026-11-01T00:00:00Z" }),
      );
      return { [field]: { items, hasMore: skip + take < total } };
    },
  ) as unknown as jest.Mock & typeof edgeQuery;
}

describe("civic sitemaps (#1456)", () => {
  it("lists the section pages, without the location-only and unlinked ones", async () => {
    const urls = (await civicSitemap("sections", { baseUrl: BASE })).map(
      (e) => e.url,
    );
    expect(urls).toContain(`${BASE}/region`);
    expect(urls).toContain(`${BASE}/region/propositions`);
    for (const path of ["county", "state", "search", "federal"]) {
      expect(urls).not.toContain(`${BASE}/region/${path}`);
    }
  });

  it("pages through a kind, a hundred at a time, edge-cached for a day", async () => {
    const query = gateway("propositions", 250);
    const entries = await civicSitemap("propositions", {
      query,
      baseUrl: BASE,
    });
    expect(entries).toHaveLength(250);
    expect(entries[0]).toMatchObject({
      url: `${BASE}/region/propositions/id-0`,
      lastModified: "2026-11-01T00:00:00Z",
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][2]).toEqual({ ttl: 86_400 });
  });

  it("asks for every bill, not just the active ones", async () => {
    const query = gateway("bills", 10);
    await civicSitemap("bills-0", { query, baseUrl: BASE });
    expect(query.mock.calls[0][0]).toContain("lifecycle: ALL");
  });

  it("keeps each bill chunk to its own thousand, and ten reads at most", async () => {
    const query = gateway("bills", 5_065);
    const second = await civicSitemap("bills-1", { query, baseUrl: BASE });
    expect(second).toHaveLength(1_000);
    expect(second[0].url).toBe(`${BASE}/region/bills/id-1000`);
    expect(second.at(-1)?.url).toBe(`${BASE}/region/bills/id-1999`);
    expect(query.mock.calls.length).toBeLessThanOrEqual(10);

    const last = await civicSitemap("bills-5", { query, baseUrl: BASE });
    expect(last).toHaveLength(65);
  });

  it("returns an empty, valid sitemap for a chunk past the last bill", async () => {
    const query = gateway("bills", 5_065);
    expect(await civicSitemap("bills-9", { query, baseUrl: BASE })).toEqual([]);
  });

  it("ends early with what it has when a read fails, never throwing", async () => {
    const query = gateway("representatives", 250, 100);
    const entries = await civicSitemap("representatives", {
      query,
      baseUrl: BASE,
    });
    expect(entries).toHaveLength(100);
  });

  it("links committees to their pages, without a date it doesn't have", async () => {
    const query = jest.fn(async () => ({
      legislativeCommittees: { items: [{ id: "c1" }], hasMore: false },
    })) as unknown as typeof edgeQuery;
    const [entry] = await civicSitemap("committees", { query, baseUrl: BASE });
    expect(entry.url).toBe(`${BASE}/region/legislative-committees/c1`);
    expect(entry.lastModified).toBeUndefined();
  });

  it("answers an unknown id with nothing", async () => {
    const query = gateway("bills", 10);
    expect(await civicSitemap("users", { query, baseUrl: BASE })).toEqual([]);
    expect(await civicSitemap("bills-10", { query, baseUrl: BASE })).toEqual(
      [],
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("names each sitemap once", () => {
    expect(new Set(CIVIC_SITEMAP_IDS).size).toBe(CIVIC_SITEMAP_IDS.length);
  });
});
