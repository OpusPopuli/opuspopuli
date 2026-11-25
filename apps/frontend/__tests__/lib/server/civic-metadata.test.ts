/**
 * Metadata for the civic record's detail pages (#1456).
 */
import { civicMetadata, snippet } from "@/lib/server/civic-metadata";
import type { edgeQuery } from "@/lib/server/edge-read";

const answer = (data: unknown) =>
  jest.fn(async () => data) as unknown as jest.Mock & typeof edgeQuery;

describe("civic metadata (#1456)", () => {
  it("describes a proposition from its analysis, with its canonical URL", async () => {
    const query = answer({
      proposition: {
        title: "Proposition 1: Test Measure",
        summary: "The scraped summary.",
        analysisSummary: "What the measure does.",
      },
    });
    const meta = await civicMetadata("proposition", "abc", query);
    expect(meta).toMatchObject({
      title: "Proposition 1: Test Measure",
      description: "What the measure does.",
      alternates: { canonical: "/region/propositions/abc" },
      openGraph: { url: "/region/propositions/abc" },
    });
    expect(meta.robots).toBeUndefined();
    expect(query.mock.calls[0][1]).toEqual({ id: "abc" });
    expect(query.mock.calls[0][2]).toEqual({ ttl: 21_600 });
  });

  it("names a bill by number and subject, and describes it by its legal text", async () => {
    const meta = await civicMetadata(
      "bill",
      "b1",
      answer({
        bill: {
          billNumber: "AB 1129",
          title: "An act to add Article 1.5 to the Health and Safety Code.",
          subject: "Birth conditions monitoring.",
        },
      }),
    );
    expect(meta.title).toBe("AB 1129: Birth conditions monitoring.");
    expect(meta.description).toBe(
      "An act to add Article 1.5 to the Health and Safety Code.",
    );
  });

  it("falls back to a shortened legal title for a bill with no subject", async () => {
    const meta = await civicMetadata(
      "bill",
      "b2",
      answer({
        bill: { billNumber: "SB 2", title: "word ".repeat(40), subject: null },
      }),
    );
    expect(String(meta.title).startsWith("SB 2: word")).toBe(true);
    expect(String(meta.title).length).toBeLessThanOrEqual("SB 2: ".length + 70);
  });

  it("describes a representative by seat", async () => {
    const meta = await civicMetadata(
      "representative",
      "r1",
      answer({
        representative: {
          name: "Jane Smith",
          chamber: "Senate",
          district: "5",
          party: "Democrat",
        },
      }),
    );
    expect(meta).toMatchObject({
      title: "Jane Smith",
      description: "Senate · District 5 · Democrat",
    });
  });

  it("falls back to a generic, still-indexable title when the read fails", async () => {
    const meta = await civicMetadata("committee", "c1", answer(null));
    expect(meta).toEqual({
      title: "Committee",
      alternates: { canonical: "/region/legislative-committees/c1" },
    });
  });

  it("keeps a record the server says doesn't exist out of the index", async () => {
    const meta = await civicMetadata("bill", "missing", answer({ bill: null }));
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("encodes the id in the canonical URL", async () => {
    const meta = await civicMetadata("bill", "a/b?c", answer(null));
    expect(meta.alternates?.canonical).toBe("/region/bills/a%2Fb%3Fc");
  });

  describe("snippet", () => {
    it("flattens whitespace and keeps short text whole", () => {
      expect(snippet("  one\n\n two  ")).toBe("one two");
      expect(snippet("   ")).toBeUndefined();
      expect(snippet(undefined)).toBeUndefined();
    });

    it("cuts long text at a word, within the length a result shows", () => {
      const long = "word ".repeat(60);
      const cut = snippet(long)!;
      expect(cut.length).toBeLessThanOrEqual(160);
      expect(cut.endsWith("word…")).toBe(true);
    });
  });
});
