import type { DataSourceConfig } from "@opuspopuli/common";
import { MinutesIngestHandler } from "../src/handlers/minutes-ingest.handler";
import {
  IngestionWatermarkService,
  type IngestionWatermarkRepository,
} from "../src/manifest/ingestion-watermark.service";

interface FetchedHtml {
  content: string;
  fromCache?: boolean;
  statusCode?: number;
  contentType?: string;
}

class FakeExtraction {
  // Map url → html or pdf-text content
  htmlByUrl = new Map<string, string>();
  pdfTextByUrl = new Map<string, string>();
  fetchHtmlCalls: string[] = [];
  fetchPdfCalls: string[] = [];

  async fetchWithRetry(url: string): Promise<FetchedHtml> {
    this.fetchHtmlCalls.push(url);
    const content = this.htmlByUrl.get(url);
    if (content === undefined) {
      throw new Error(`Unexpected fetchWithRetry for ${url}`);
    }
    return {
      content,
      fromCache: false,
      statusCode: 200,
      contentType: "text/html",
    };
  }

  async fetchPdfText(url: string): Promise<string> {
    this.fetchPdfCalls.push(url);
    const content = this.pdfTextByUrl.get(url);
    if (content === undefined) {
      throw new Error(`Unexpected fetchPdfText for ${url}`);
    }
    return content;
  }
}

const SOURCE: DataSourceConfig = {
  url: "https://clerk.example/journals",
  dataType: "meetings" as DataSourceConfig["dataType"],
  contentGoal: "test",
  category: "Assembly",
  sourceType: "pdf_archive",
  pdfArchive: {
    linkSelector: "a[href$='.pdf']",
    datePattern: "adj(\\d{2})(\\d{2})(\\d{2})(?:_r\\d+)?\\.pdf",
    dateFormat: "MMDDYY",
    revisionPattern: "_r(\\d+)\\.pdf$",
    maxNew: 10,
    maxPages: 1,
  },
};

const LISTING_HTML = `
  <html><body>
    <a href="/files/adj042826.pdf">April 28, 2026</a>
    <a href="/files/adj042726.pdf">April 27, 2026</a>
    <a href="/files/adj042126_r1.pdf">April 21, 2026 (revised)</a>
    <a href="/files/skip-me.html">irrelevant link</a>
  </body></html>
`;

const PDF_TEXT_2026_04_28 = "Tuesday, April 28, 2026\nROLLCALL\n[ ... ]";
const PDF_TEXT_2026_04_27 = "Monday, April 27, 2026\nROLLCALL\n[ ... ]";
const PDF_TEXT_2026_04_21_R1 = "Monday, April 21, 2026 (revised)\n[ ... ]";

class InMemoryWatermarkRepo implements IngestionWatermarkRepository {
  records = new Map<string, any>();

  async findFirst(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
  }) {
    const key = `${args.where.regionId}::${args.where.sourceUrl}::${args.where.dataType}`;
    return this.records.get(key) ?? null;
  }

  async upsert(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
    create: any;
    update: any;
  }) {
    const key = `${args.where.regionId}::${args.where.sourceUrl}::${args.where.dataType}`;
    const existing = this.records.get(key);
    const now = new Date();
    if (!existing) {
      const record = { ...args.create, createdAt: now, updatedAt: now };
      this.records.set(key, record);
      return record;
    }
    let itemsIngested = existing.itemsIngested;
    const u = args.update.itemsIngested;
    if (u && typeof u === "object" && "increment" in u) {
      itemsIngested += u.increment;
    }
    const updated = {
      ...existing,
      ...args.update,
      itemsIngested,
      updatedAt: now,
    };
    this.records.set(key, updated);
    return updated;
  }
}

const setupExtraction = (): FakeExtraction => {
  const fake = new FakeExtraction();
  fake.htmlByUrl.set("https://clerk.example/journals", LISTING_HTML);
  fake.pdfTextByUrl.set(
    "https://clerk.example/files/adj042826.pdf",
    PDF_TEXT_2026_04_28,
  );
  fake.pdfTextByUrl.set(
    "https://clerk.example/files/adj042726.pdf",
    PDF_TEXT_2026_04_27,
  );
  fake.pdfTextByUrl.set(
    "https://clerk.example/files/adj042126_r1.pdf",
    PDF_TEXT_2026_04_21_R1,
  );
  return fake;
};

describe("MinutesIngestHandler", () => {
  it("walks the listing, fetches each PDF, and emits one Minutes per document", async () => {
    const fake = setupExtraction();
    const handler = new MinutesIngestHandler(fake as never);
    const result = await handler.execute(SOURCE, "ca");

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(3);

    const externalIds = result.items.map((b) => b.minutes.externalId).sort();
    expect(externalIds).toEqual([
      "ca-meetings-2026-04-21-r1",
      "ca-meetings-2026-04-27",
      "ca-meetings-2026-04-28",
    ]);
    // Each Minutes carries the PDF text + body (from category).
    for (const bundle of result.items) {
      expect(bundle.minutes.body).toBe("Assembly");
      expect(
        bundle.minutes.rawText && bundle.minutes.rawText.length,
      ).toBeGreaterThan(0);
      expect(bundle.minutes.isActive).toBe(true);
      // V1 fetcher returns empty actions; the backend linker fills these in.
      expect(bundle.actions).toEqual([]);
    }
  });

  it("processes oldest → newest (so a partial failure leaves watermark advanced only to last success)", async () => {
    const fake = setupExtraction();
    const handler = new MinutesIngestHandler(fake as never);
    await handler.execute(SOURCE, "ca");
    expect(fake.fetchPdfCalls).toEqual([
      "https://clerk.example/files/adj042126_r1.pdf",
      "https://clerk.example/files/adj042726.pdf",
      "https://clerk.example/files/adj042826.pdf",
    ]);
  });

  it("respects the watermark and stops at previously-ingested documents", async () => {
    const fake = setupExtraction();
    const repo = new InMemoryWatermarkRepo();
    const watermarks = new IngestionWatermarkService(repo);
    // Pretend Apr 27 is already ingested.
    await watermarks.advance(
      "ca",
      SOURCE.url,
      SOURCE.dataType,
      "ca-meetings-2026-04-27",
      0,
    );

    const handler = new MinutesIngestHandler(fake as never, watermarks);
    const result = await handler.execute(SOURCE, "ca");

    // Only Apr 28 is new — listing walk halts when it hits the watermark id.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].minutes.externalId).toBe("ca-meetings-2026-04-28");

    // Watermark advances to the newest ingested.
    const wm = await watermarks.read("ca", SOURCE.url, SOURCE.dataType);
    expect(wm?.lastExternalId).toBe("ca-meetings-2026-04-28");
  });

  it("caps cold-start ingestion at maxNew", async () => {
    const fake = setupExtraction();
    const handler = new MinutesIngestHandler(fake as never);
    const result = await handler.execute(
      { ...SOURCE, pdfArchive: { ...SOURCE.pdfArchive!, maxNew: 2 } },
      "ca",
    );
    expect(result.items).toHaveLength(2);
    // The two newest documents win (Apr 28 + Apr 27).
    const ids = result.items.map((b) => b.minutes.externalId).sort();
    expect(ids).toEqual(["ca-meetings-2026-04-27", "ca-meetings-2026-04-28"]);
  });

  it("captures revisionSeq from filenames matching revisionPattern", async () => {
    const fake = setupExtraction();
    const handler = new MinutesIngestHandler(fake as never);
    const result = await handler.execute(SOURCE, "ca");
    const revised = result.items.find(
      (b) => b.minutes.externalId === "ca-meetings-2026-04-21-r1",
    );
    expect(revised).toBeDefined();
    expect(revised!.minutes.revisionSeq).toBe(1);
  });

  it("fails gracefully when the source is missing pdfArchive config", async () => {
    const fake = setupExtraction();
    const handler = new MinutesIngestHandler(fake as never);
    const result = await handler.execute(
      { ...SOURCE, pdfArchive: undefined },
      "ca",
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/missing 'pdfArchive'/);
  });
});
