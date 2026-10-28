import { createHash } from "node:crypto";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtractionProvider, stripNulBytes } from "../src/extraction.provider";
import { FetchError } from "../src/types";
import {
  PDF_EXTRACTOR_VERSION,
  PdfExtractor,
} from "../src/utils/pdf-extractor";
import type { MetricsObserver } from "@opuspopuli/common";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Build a real `Response` for the fetch mock.
 *
 * Deliberately a genuine `Response` rather than an object literal: the
 * provider reads the body as bytes and decodes it itself (#1276), so `text()`
 * and `arrayBuffer()` must come from the same body and `headers` must have
 * real `Headers` semantics. The hand-rolled fakes this replaced stubbed
 * `text()` directly, which meant no test here could observe decoding at all.
 *
 * Note a real body can only be read once, so a persistent mock must build a
 * fresh response per call (`mockImplementation`) rather than resolve the same
 * instance repeatedly — the old stubs allowed `text()` to be called forever.
 *
 * `url` is defined only when a redirect is being simulated — a real
 * `Response` reports `""`, which is what the provider treats as "no redirect".
 */
function httpResponse(
  body: string | Buffer,
  {
    status = 200,
    statusText = "OK",
    contentType = "text/html",
    url,
  }: {
    status?: number;
    statusText?: string;
    contentType?: string | null;
    url?: string;
  } = {},
): Response {
  const response = new Response(body, {
    status,
    statusText,
    headers: contentType ? { "content-type": contentType } : {},
  });

  if (url !== undefined) {
    Object.defineProperty(response, "url", { value: url });
  }

  return response;
}

// Mock pdf-parse v2 API
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: "Extracted PDF text" }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("ExtractionProvider", () => {
  let provider: ExtractionProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    provider = new ExtractionProvider();
  });

  afterEach(() => {
    provider.onModuleDestroy();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create provider with default config", () => {
      expect(provider).toBeDefined();
    });

    it("should create provider with custom config", () => {
      const customProvider = new ExtractionProvider({
        cache: { ttlMs: 60000 },
        rateLimit: { requestsPerSecond: 10 },
        retry: { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 10000 },
      });
      expect(customProvider).toBeDefined();
      customProvider.onModuleDestroy();
    });
  });

  describe("per-host rate limit (S1)", () => {
    /** The provider's own limiter, spied. */
    const limiterOf = (p: ExtractionProvider) =>
      (p as unknown as { hostRateLimiter: { acquire: jest.Mock } })
        .hostRateLimiter;

    it("waits on the limiter with the normalized URL before fetching text", async () => {
      // Replacing the acquire with a no-op used to pass every test here.
      const acquire = jest
        .spyOn(limiterOf(provider), "acquire")
        .mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce(httpResponse("<html></html>"));

      await provider.fetchUrl("https://Example.com/a#frag", {
        bypassCache: true,
      });

      expect(acquire).toHaveBeenCalledTimes(1);
      expect(acquire.mock.calls[0][0]).toMatch(/^https:\/\/example\.com\/a/);
    });

    it("waits on the limiter before fetching bytes", async () => {
      const acquire = jest
        .spyOn(limiterOf(provider), "acquire")
        .mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce(httpResponse("%PDF-1.4"));

      await provider.fetchBytes("https://example.com/doc.pdf");

      expect(acquire).toHaveBeenCalledWith("https://example.com/doc.pdf");
    });

    it("lends the same limiter to handlers that fetch on their own", async () => {
      const acquire = jest
        .spyOn(limiterOf(provider), "acquire")
        .mockResolvedValue(undefined);

      await provider.acquireHostSlot("https://api.open.fec.gov/v1/x");

      expect(acquire).toHaveBeenCalledWith("https://api.open.fec.gov/v1/x");
    });
  });

  describe("fetchUrl", () => {
    it("should fetch URL and return content", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("<html>content</html>"));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.content).toBe("<html>content</html>");
      expect(result.fromCache).toBe(false);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should return cached result on second call", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("content"));

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call should be cached
      const result = await provider.fetchUrl("https://example.com");

      expect(result.fromCache).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when option is set", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call with bypass
      const result = await provider.fetchUrl("https://example.com", {
        bypassCache: true,
      });

      expect(result.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should detect URL redirect and include redirect info in result", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("<html>redirected</html>", {
          url: "https://example.com/new-path",
        }),
      );

      const result = await provider.fetchUrl("https://example.com/old-path");

      expect(result.redirectedFrom).toBe("https://example.com/old-path");
      expect(result.finalUrl).toBe("https://example.com/new-path");
      expect(result.content).toBe("<html>redirected</html>");
    });

    it("should not set redirect fields when URL is unchanged", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("content", { url: "https://example.com" }),
      );

      const result = await provider.fetchUrl("https://example.com");

      expect(result.redirectedFrom).toBeUndefined();
      expect(result.finalUrl).toBeUndefined();
    });

    it("should throw FetchError on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("", { status: 404, statusText: "Not Found" }),
      );

      await expect(
        provider.fetchUrl("https://example.com/notfound"),
      ).rejects.toThrow(FetchError);
    });

    it("should include custom headers", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("content"));

      await provider.fetchUrl("https://example.com", {
        headers: { Authorization: "Bearer token" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/",
        expect.objectContaining({
          headers: { Authorization: "Bearer token" },
        }),
      );
    });

    it("should use different cache keys for different headers", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com", {
        headers: { Accept: "text/html" },
      });
      await provider.fetchUrl("https://example.com", {
        headers: { Accept: "application/json" },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should respect rate limiting", async () => {
      // Create provider with low rate limit
      const limitedProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 2, burstSize: 2 },
      });

      mockFetch.mockImplementation(async () => httpResponse("content"));

      // Exhaust burst
      await limitedProvider.fetchUrl("https://example.com/1", {
        bypassCache: true,
      });
      await limitedProvider.fetchUrl("https://example.com/2", {
        bypassCache: true,
      });

      // Third request should wait
      const promise = limitedProvider.fetchUrl("https://example.com/3", {
        bypassCache: true,
      });

      // Advance time to allow request
      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      limitedProvider.onModuleDestroy();
    });
  });

  describe("fetch provenance (#1276)", () => {
    const body = "<html>Measure A</html>";
    const expectedHash = createHash("sha256")
      .update(Buffer.from(body, "utf8"))
      .digest("hex");

    it("content-addresses the fetched body", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.contentHash).toBe(expectedHash);
      expect(result.content).toBe(body);
    });

    it("records when the body was received, as an ISO string", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      // A string, not a Date: fetch results round-trip through a JSON cache.
      expect(typeof result.fetchedAt).toBe("string");
      expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
    });

    it("captures HTTP validators when the server sends them", async () => {
      const response = httpResponse(body);
      response.headers.set("etag", '"abc123"');
      response.headers.set("last-modified", "Wed, 17 Sep 2026 10:00:00 GMT");
      mockFetch.mockResolvedValueOnce(response);

      const result = await provider.fetchUrl("https://example.com");

      expect(result.etag).toBe('"abc123"');
      expect(result.lastModified).toBe("Wed, 17 Sep 2026 10:00:00 GMT");
    });

    it("omits validators the server did not send", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.etag).toBeUndefined();
      expect(result.lastModified).toBeUndefined();
    });

    it("hashes the raw bytes, not the decoded text", async () => {
      // A BOM-prefixed body decodes to the same string as a bare one. Hashing
      // decoded text would call these one source; they are two versions.
      const bommed = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(body, "utf8"),
      ]);
      mockFetch.mockResolvedValueOnce(httpResponse(bommed));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.content).toBe(body);
      expect(result.contentHash).not.toBe(expectedHash);
      expect(result.contentHash).toBe(
        createHash("sha256").update(bommed).digest("hex"),
      );
    });

    it("preserves the original hash and fetch time across a cache hit", async () => {
      jest.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
      mockFetch.mockResolvedValueOnce(httpResponse(body));
      const fresh = await provider.fetchUrl("https://example.com");

      // Move the clock before the cache hit. Comparing the two results alone
      // would pass even if the cached value were re-stamped, because both
      // calls land in the same millisecond under fake timers.
      jest.setSystemTime(new Date("2026-09-18T10:05:00.000Z"));
      const cached = await provider.fetchUrl("https://example.com");

      // A cache hit received no bytes, so it must not claim a fresh fetch
      // time or recompute a hash from decoded text.
      expect(cached.fromCache).toBe(true);
      expect(cached.contentHash).toBe(fresh.contentHash);
      expect(cached.fetchedAt).toBe("2026-09-18T10:00:00.000Z");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("carries provenance on the binary path too", async () => {
      const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      mockFetch.mockResolvedValueOnce(
        httpResponse(pdf, { contentType: "application/pdf" }),
      );

      const result = await provider.fetchBytes("https://example.com/a.pdf");

      expect(result.contentHash).toBe(
        createHash("sha256").update(pdf).digest("hex"),
      );
      expect(result.content.equals(pdf)).toBe(true);
    });
  });

  describe("source archive (#1276)", () => {
    const body = "<html>Measure A</html>";
    const expectedHash = createHash("sha256")
      .update(Buffer.from(body, "utf8"))
      .digest("hex");
    let archive: { archive: jest.Mock };
    let archivingProvider: ExtractionProvider;

    beforeEach(() => {
      archive = { archive: jest.fn().mockResolvedValue(undefined) };
      archivingProvider = new ExtractionProvider(
        { cacheProvider: "memory" },
        undefined,
        archive,
      );
    });

    afterEach(async () => {
      await archivingProvider.onModuleDestroy?.();
    });

    it("archives the raw bytes, not the decoded text", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { regionId: "us-ca", dataType: "propositions" },
      });

      expect(archive.archive).toHaveBeenCalledTimes(1);
      const [recorded] = archive.archive.mock.calls[0];
      expect(Buffer.isBuffer(recorded.content)).toBe(true);
      expect(recorded.content.equals(Buffer.from(body, "utf8"))).toBe(true);
      expect(recorded.contentHash).toBe(expectedHash);
    });

    it("passes the run context through to the archive", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: {
          regionId: "us-ca",
          dataType: "propositions",
          executionId: "exec-1",
          manifestId: "manifest-1",
        },
      });

      expect(archive.archive).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: "https://example.gov/a",
          regionId: "us-ca",
          dataType: "propositions",
          executionId: "exec-1",
          manifestId: "manifest-1",
        }),
      );
    });

    it("does not archive a fetch that did not ask to be archived", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a");

      // The store is sized for artifacts claims cite. Archiving every list
      // page and discovery crawl would fill it with pages nothing cites.
      expect(archive.archive).not.toHaveBeenCalled();
    });

    it("goes to the network even when the body is cached", async () => {
      mockFetch.mockImplementation(async () => httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a");
      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // A cache hit carries decoded text only — archiving from it is
      // impossible, so an archived fetch must not be served from cache.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(archive.archive).toHaveBeenCalledTimes(1);
    });

    it("returns content even when archiving fails", async () => {
      archive.archive.mockRejectedValue(new Error("database unavailable"));
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // Evidence capture runs alongside the fetch. A sync must not die
      // because the archive was down — the caller asked for content.
      expect(result.content).toBe(body);
    });

    it("never returns the raw buffer to callers", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // The buffer is carried out of the circuit breaker only so archiving can
      // happen outside it. If it escaped, it would be JSON-serialised into
      // Redis on every fetch for a value nothing downstream reads.
      expect(
        (result as unknown as Record<string, unknown>).bytes,
      ).toBeUndefined();
    });

    it("is inert when no archive is bound", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      expect(result.content).toBe(body);
    });
  });

  describe("PDF parse reuse (K-P1)", () => {
    const pdfBytes = Buffer.from("%PDF-1.6 unchanged bytes");
    let archive: {
      archive: jest.Mock;
      findParsedText: jest.Mock;
      recordParsedText: jest.Mock;
    };
    let archivingProvider: ExtractionProvider;
    let extract: jest.SpyInstance;

    beforeEach(() => {
      archive = {
        archive: jest.fn().mockResolvedValue({ sourceVersionId: "sv-1" }),
        findParsedText: jest.fn().mockResolvedValue(undefined),
        recordParsedText: jest.fn().mockResolvedValue(undefined),
      };
      archivingProvider = new ExtractionProvider(
        { cacheProvider: "memory" },
        undefined,
        archive,
      );
      extract = jest
        .spyOn(PdfExtractor, "extractWithOutcome")
        .mockResolvedValue({ text: "parsed\u0000 text", complete: true });
      mockFetch.mockImplementation(async () =>
        httpResponse(pdfBytes, {
          contentType: "application/pdf",
          url: "https://example.gov/m.pdf",
        }),
      );
    });

    afterEach(async () => {
      extract.mockRestore();
      await archivingProvider.onModuleDestroy?.();
    });

    const fetchPdf = () =>
      archivingProvider.fetchPdfText("https://example.gov/m.pdf", {
        archive: { dataType: "propositions" },
      } as never);

    it("parses an archived PDF once, then reuses the parse for the same bytes", async () => {
      await fetchPdf();
      const [id, key, text] = archive.recordParsedText.mock.calls[0];
      expect([id, text]).toEqual(["sv-1", "parsed text"]);
      // The cascade version plus a hash of what this process parses with.
      expect(key).toMatch(
        new RegExp(`^${PDF_EXTRACTOR_VERSION}\\+[0-9a-f]{12}$`),
      );
      expect(key.length).toBeLessThanOrEqual(40);

      archive.findParsedText.mockResolvedValue("parsed text");
      extract.mockClear();
      const second = await fetchPdf();

      // The bytes are still fetched — their address is the proof — but the
      // 78%-of-the-run parse is not repeated.
      expect(extract).not.toHaveBeenCalled();
      expect(second).toEqual({ text: "parsed text", sourceVersionId: "sv-1" });
      expect(archive.findParsedText).toHaveBeenLastCalledWith("sv-1", key);
    });

    it("keys a parse by how this process OCRs, so another OCR setup re-parses", async () => {
      const ocr = (languages: string[]) => ({
        extractFromBuffer: jest.fn(),
        getProviderInfo: () => ({
          name: "Tesseract",
          supportedLanguages: languages,
        }),
      });
      const keyOf = async (languages: string[]) => {
        const p = new ExtractionProvider(
          { cacheProvider: "memory" },
          ocr(languages),
          archive,
        );
        archive.recordParsedText.mockClear();
        await p.fetchPdfText("https://example.gov/m.pdf", {
          archive: { dataType: "propositions" },
        } as never);
        await p.onModuleDestroy?.();
        return archive.recordParsedText.mock.calls[0][1] as string;
      };

      expect(await keyOf(["eng"])).not.toBe(await keyOf(["eng", "spa"]));
      expect(await keyOf(["eng"])).toBe(await keyOf(["eng"]));
    });

    it("does not record a parse that fell back — OCR down must not be pinned", async () => {
      extract.mockResolvedValue({ text: "best effort", complete: false });

      const result = await fetchPdf();

      expect(result.text).toBe("best effort");
      expect(archive.recordParsedText).not.toHaveBeenCalled();
    });

    it("parses, and records nothing, when the bytes were not archived", async () => {
      archive.archive.mockResolvedValue({});

      await fetchPdf();

      expect(archive.findParsedText).not.toHaveBeenCalled();
      expect(archive.recordParsedText).not.toHaveBeenCalled();
      expect(extract).toHaveBeenCalledTimes(1);
    });

    describe("on the PDF parse lane (S6)", () => {
      const withLane = (parse: jest.Mock) =>
        new ExtractionProvider(
          { cacheProvider: "memory" },
          undefined,
          archive,
          undefined,
          { parse },
        );
      const fetchVia = async (provider: ExtractionProvider) => {
        const result = await provider.fetchPdfText(
          "https://example.gov/m.pdf",
          {
            archive: { dataType: "propositions" },
          } as never,
        );
        await provider.onModuleDestroy?.();
        return result;
      };

      it("takes the lane's parse and parses nothing here", async () => {
        const parse = jest.fn().mockResolvedValue("parsed on the lane");

        const result = await fetchVia(withLane(parse));

        expect(result.text).toBe("parsed on the lane");
        expect(parse).toHaveBeenCalledWith(
          "sv-1",
          expect.stringMatching(/^pdf-extractor-1\+/),
        );
        expect(extract).not.toHaveBeenCalled();
      });

      it("parses here when the lane delivers nothing", async () => {
        const parse = jest.fn().mockResolvedValue(undefined);

        const result = await fetchVia(withLane(parse));

        expect(result.text).toBe("parsed text");
        expect(extract).toHaveBeenCalledTimes(1);
      });

      it("counts where each parse came from — the CPU lane's miss rate", async () => {
        const metrics = { increment: jest.fn(), observe: jest.fn() };
        const counted = (parse: jest.Mock) =>
          new ExtractionProvider(
            { cacheProvider: "memory" },
            undefined,
            archive,
            metrics,
            { parse },
          );
        const sources = () =>
          metrics.increment.mock.calls
            .filter(([name]) => name === "pdf_parse_total")
            .map(([, , labels]) => `${labels.source}:${labels.complete}`);

        archive.findParsedText.mockResolvedValueOnce("recorded");
        await fetchVia(counted(jest.fn()));
        await fetchVia(counted(jest.fn().mockResolvedValue("laned")));
        await fetchVia(counted(jest.fn().mockResolvedValue(undefined)));
        extract.mockResolvedValueOnce({ text: "partial", complete: false });
        await fetchVia(counted(jest.fn().mockResolvedValue(undefined)));

        expect(sources()).toEqual([
          "reused:true",
          "lane:true",
          "in_process:true",
          "in_process:false",
        ]);
      });

      it("is not asked when a recorded parse is reused, or the bytes were not archived", async () => {
        const parse = jest.fn();
        archive.findParsedText.mockResolvedValueOnce("recorded");
        await fetchVia(withLane(parse));

        archive.archive.mockResolvedValueOnce({});
        await fetchVia(withLane(parse));

        expect(parse).not.toHaveBeenCalled();
      });
    });

    it("parses as before with an archive that keeps no parses", async () => {
      const plain = new ExtractionProvider(
        { cacheProvider: "memory" },
        undefined,
        { archive: jest.fn().mockResolvedValue({ sourceVersionId: "sv-1" }) },
      );

      await expect(
        plain.fetchPdfText("https://example.gov/m.pdf", {
          archive: { dataType: "propositions" },
        } as never),
      ).resolves.toMatchObject({ text: "parsed text" });
      await plain.onModuleDestroy?.();
    });
  });

  describe("fetchWithRetry", () => {
    it("should retry on failure and succeed", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(httpResponse("content"));

      const promise = provider.fetchWithRetry("https://example.com", {
        bypassCache: true,
      });

      // Advance through retry delay
      await jest.advanceTimersByTimeAsync(5000);

      const result = await promise;
      expect(result.content).toBe("content");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use custom retry options", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      let caughtError: Error | null = null;
      const promise = provider
        .fetchWithRetry("https://example.com", {
          maxRetries: 2,
          baseDelayMs: 100,
          bypassCache: true,
        })
        .catch((e) => {
          caughtError = e;
        });

      // Advance time incrementally to allow retries
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(1000);
      }
      await promise;

      expect(caughtError).toBeDefined();
      // maxRetries = 2 means 2 total attempts
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("extractPdfText", () => {
    it("should extract text from PDF buffer", async () => {
      const buffer = Buffer.from("fake pdf content");

      const text = await provider.extractPdfText(buffer);

      expect(text).toBe("Extracted PDF text");
    });

    // #912: scanned / mixed-encoding PDFs emit NUL bytes (0x00) that Postgres
    // text columns reject ("invalid byte sequence for encoding UTF8"), crashing
    // any downstream DB write (e.g. minutes.rawText). extractPdfText is the
    // single choke point every PDF path flows through, so it must sanitize.
    it("should strip NUL bytes emitted by the underlying PDF extractor", async () => {
      const { PDFParse } = jest.requireMock("pdf-parse");
      PDFParse.mockImplementationOnce(() => ({
        getText: jest
          .fn()
          .mockResolvedValue({ text: "clean\u0000text\u0000here" }),
        destroy: jest.fn().mockResolvedValue(undefined),
      }));

      const text = await provider.extractPdfText(Buffer.from("fake pdf"));

      expect(text).toBe("cleantexthere");
      expect(text).not.toContain("\u0000");
    });
  });

  describe("stripNulBytes", () => {
    it("removes every NUL byte (0x00) from the input", () => {
      expect(stripNulBytes("a\u0000b\u0000c")).toBe("abc");
    });

    it("returns non-NUL text unchanged", () => {
      expect(stripNulBytes("no nuls here")).toBe("no nuls here");
    });

    it("handles empty and all-NUL strings", () => {
      expect(stripNulBytes("")).toBe("");
      expect(stripNulBytes("\u0000\u0000\u0000")).toBe("");
    });
  });

  describe("fetchBytes / fetchPdfText", () => {
    /**
     * Build a buffer containing the PDF magic bytes plus a few bytes
     * outside the ASCII range. A UTF-8 round-trip via response.text()
     * would replace 0x80-0xFF bytes with the U+FFFD replacement
     * character (a 3-byte UTF-8 sequence), so a Buffer reconstructed
     * from such a string would have a different length AND different
     * contents — exactly the failure mode that breaks PDFParse.
     */
    function pdfishBuffer(): Buffer {
      return Buffer.concat([
        Buffer.from("%PDF-1.6\n"),
        Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0d, 0x0a]), // binary marker
        Buffer.from("1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
        Buffer.from([0x80, 0x81, 0x82, 0xff]), // arbitrary non-ASCII bytes
      ]);
    }

    /**
     * Build a fresh standalone ArrayBuffer with exactly the source
     * bytes — `Buffer#buffer` returns the underlying pool's full
     * ArrayBuffer (often 8KB), not the slice the Buffer represents.
     */
    function asArrayBuffer(buf: Buffer): ArrayBuffer {
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      return ab;
    }

    it("returns the response body as a Buffer with bytes preserved exactly", async () => {
      const original = pdfishBuffer();
      mockFetch.mockResolvedValueOnce(
        httpResponse(original, {
          contentType: "application/pdf",
          url: "https://example.com/test.pdf",
        }),
      );

      const result = await provider.fetchBytes("https://example.com/test.pdf");

      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.content.length).toBe(original.length);
      // Critical: every byte preserved (not UTF-8-mangled)
      expect(result.content.equals(original)).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.contentType).toBe("application/pdf");
    });

    it("fetchPdfText pipes binary-safe bytes into extractPdfText", async () => {
      const original = pdfishBuffer();
      let bufferGivenToParser: Buffer | undefined;

      // Replace the global pdf-parse mock to capture what extractPdfText
      // received, so we can assert it wasn't UTF-8-mangled by the fetch path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      pdfParse.PDFParse.mockImplementationOnce(({ data }: { data: Buffer }) => {
        bufferGivenToParser = data;
        return {
          getText: jest.fn().mockResolvedValue({ text: "ok" }),
          destroy: jest.fn().mockResolvedValue(undefined),
        };
      });

      mockFetch.mockResolvedValueOnce(
        httpResponse(original, {
          contentType: "application/pdf",
          url: "https://example.com/test.pdf",
        }),
      );

      const { text } = await provider.fetchPdfText(
        "https://example.com/test.pdf",
      );

      expect(text).toBe("ok");
      expect(bufferGivenToParser).toBeInstanceOf(Buffer);
      expect(bufferGivenToParser!.equals(original)).toBe(true);
    });

    it("fetchBytesWithRetry retries on transient error then succeeds", async () => {
      const original = pdfishBuffer();
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(
          httpResponse(original, {
            contentType: "application/pdf",
            url: "https://example.com/x.pdf",
          }),
        );

      const promise = provider.fetchBytesWithRetry(
        "https://example.com/x.pdf",
        {
          bypassCache: true,
        } as never,
      );

      // Drain the retry backoff timer (mirrors the existing
      // fetchWithRetry retry test's shape — single advance, not
      // runAllTimersAsync, to avoid the cache-cleanup interval loop)
      await jest.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.content.equals(original)).toBe(true);
    });

    it("throws FetchError on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse(Buffer.alloc(0), {
          status: 404,
          statusText: "Not Found",
          contentType: null,
          url: "https://example.com/missing.pdf",
        }),
      );

      await expect(
        provider.fetchBytes("https://example.com/missing.pdf"),
      ).rejects.toThrow(FetchError);
    });
  });

  describe("selectElements", () => {
    const html = `
      <html>
        <body>
          <div class="item" id="first" data-value="1">
            <span class="title">First Item</span>
            <span class="description">Description 1</span>
          </div>
          <div class="item" id="second" data-value="2">
            <span class="title">Second Item</span>
            <span class="description">Description 2</span>
          </div>
          <div class="other">Not an item</div>
        </body>
      </html>
    `;

    it("should select elements by CSS selector", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements).toHaveLength(2);
    });

    it("should provide text content", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].text).toContain("First Item");
      expect(elements[1].text).toContain("Second Item");
    });

    it("should provide html content", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].html).toContain('<span class="title">');
    });

    it("should provide attributes", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].attributes.id).toBe("first");
      expect(elements[0].attributes["data-value"]).toBe("1");
      expect(elements[0].attr("id")).toBe("first");
    });

    it("should support find for nested elements", () => {
      const elements = provider.selectElements(html, ".item");

      const titles = elements[0].find(".title");
      expect(titles).toHaveLength(1);
      expect(titles[0].text).toBe("First Item");
    });

    it("should support hasClass", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].hasClass("item")).toBe(true);
      expect(elements[0].hasClass("other")).toBe(false);
    });

    it("should return empty array for no matches", () => {
      const elements = provider.selectElements(html, ".nonexistent");

      expect(elements).toHaveLength(0);
    });
  });

  describe("parseHtml", () => {
    it("should return cheerio instance", () => {
      const $ = provider.parseHtml("<div>test</div>");

      expect($("div").text()).toBe("test");
    });
  });

  describe("cache management", () => {
    it("should get cache stats", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com");

      const stats = await provider.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toHaveLength(1);
    });

    it("should clear cache", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com");
      await provider.clearCache();

      const stats = await provider.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("onModuleDestroy", () => {
    it("should cleanup resources", async () => {
      await expect(provider.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe("circuit breaker", () => {
    it("should provide circuit breaker health", () => {
      const health = provider.getCircuitBreakerHealth();

      expect(health).toBeDefined();
      expect(health.serviceName).toBe("Extraction");
      expect(health.state).toBe("closed");
      expect(health.isHealthy).toBe(true);
      expect(health.failureCount).toBe(0);
    });

    it("should track failures and open circuit after threshold", async () => {
      // Create provider with lower threshold for testing
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });

      // Simulate 5 consecutive failures (default threshold)
      mockFetch.mockRejectedValue(new Error("Network error"));

      for (let i = 0; i < 5; i++) {
        await testProvider
          .fetchUrl(`https://example.com/${i}`, {
            bypassCache: true,
          })
          .catch(() => {});
      }

      // Check health after failures - circuit should be open
      const health = testProvider.getCircuitBreakerHealth();
      expect(health.failureCount).toBeGreaterThan(0);

      testProvider.onModuleDestroy();
    });

    it("keeps one host's failures from opening another host's breaker", async () => {
      // 2026-10-27: the Assembly's asmdc.org bio pages failed five in a row,
      // opened the single shared breaker, and the Senate roster — a healthy
      // host fetched next — was refused: 40 senators dropped.
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("a30.asmdc.org")) throw new Error("fetch failed");
        return httpResponse("senators");
      });

      for (let i = 0; i < 6; i++) {
        await testProvider
          .fetchUrl(`https://a30.asmdc.org/biography?${i}`, {
            bypassCache: true,
          })
          .catch(() => {});
      }
      expect(testProvider.getCircuitBreakerHealth("a30.asmdc.org").state).toBe(
        "open",
      );

      await expect(
        testProvider.fetchUrl("https://www.senate.ca.gov/senators", {
          bypassCache: true,
        }),
      ).resolves.toMatchObject({ content: "senators" });
      expect(
        testProvider.getCircuitBreakerHealth("www.senate.ca.gov").state,
      ).toBe("closed");
      // The summary still says something is open.
      expect(testProvider.getCircuitBreakerHealth().state).toBe("open");

      testProvider.onModuleDestroy();
    });

    it("treats a trailing-dot host as the same site — one breaker, as the rate limiter does", async () => {
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });
      mockFetch.mockRejectedValue(new Error("fetch failed"));

      for (let i = 0; i < 6; i++) {
        const host = i % 2 === 0 ? "fec.gov" : "fec.gov.";
        await testProvider
          .fetchUrl(`https://${host}/x?${i}`, { bypassCache: true })
          .catch(() => {});
      }
      // Two breakers would each have seen 3 failures, below the limit of 5.
      expect(testProvider.getCircuitBreakerHealth("fec.gov").state).toBe(
        "open",
      );

      testProvider.onModuleDestroy();
    });

    it("keeps an unparseable URL out of every breaker", async () => {
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });

      for (let i = 0; i < 6; i++) {
        await testProvider
          .fetchUrl(`not a url ${i}`, { bypassCache: true })
          .catch(() => {});
      }
      // Six bad URLs used to share one "unparseable" breaker and trip it.
      expect(testProvider.getCircuitBreakerHealth().state).toBe("closed");

      testProvider.onModuleDestroy();
    });

    it("should recover after half-open period", async () => {
      // Create provider
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });

      // First, open the circuit
      mockFetch.mockRejectedValue(new Error("Network error"));
      for (let i = 0; i < 5; i++) {
        await testProvider
          .fetchUrl(`https://example.com/${i}`, {
            bypassCache: true,
          })
          .catch(() => {});
      }

      // Then succeed
      mockFetch.mockImplementation(async () => httpResponse("content"));

      // Advance time past half-open period (60 seconds for extraction)
      await jest.advanceTimersByTimeAsync(61000);

      // Try to fetch again - should succeed if circuit allows
      await testProvider
        .fetchUrl("https://example.com/recover", {
          bypassCache: true,
        })
        .catch(() => {});

      testProvider.onModuleDestroy();
    });
  });
  describe("pipeline fetch stage (M1)", () => {
    /**
     * The scraping pipeline reaches the network almost entirely through
     * `fetchWithRetry`, NOT through region's own `fetchTextWithRetry`. With
     * only the latter instrumented, a representatives sync that crawled 120
     * members and failed ~80 Assembly biography pages reported a `fetch`
     * stage of exactly ZERO — a clean-looking run that had lost most of its
     * secondary detail. These assert the stage is emitted from this path.
     */
    const withObserver = () => {
      const observed: [string, Record<string, string> | undefined][] = [];
      const metrics: MetricsObserver = {
        observe: (metric, _v, labels) => observed.push([metric, labels]),
        increment: () => undefined,
      };
      return {
        observed,
        provider: new ExtractionProvider(
          undefined,
          undefined,
          undefined,
          metrics,
        ),
      };
    };

    it("times fetchWithRetry as the `fetch` stage", async () => {
      const { provider: measured, observed } = withObserver();
      mockFetch.mockResolvedValueOnce(httpResponse("<html>ok</html>"));

      await measured.fetchWithRetry("https://example.gov/page");

      expect(observed).toContainEqual([
        "pipeline_stage_duration_seconds",
        { stage: "fetch" },
      ]);
      measured.onModuleDestroy();
    });

    it("still records the stage when every attempt fails", async () => {
      // The Assembly case: 80 pages lost. A failure that is not measured is
      // a run that looks faster than it was.
      const { provider: measured, observed } = withObserver();
      mockFetch.mockRejectedValue(new Error("fetch failed"));

      await expect(
        measured.fetchWithRetry("https://a30.asmdc.org/biography", {
          maxRetries: 0,
        }),
      ).rejects.toThrow();

      expect(
        observed.filter(([m]) => m === "pipeline_stage_duration_seconds"),
      ).toHaveLength(1);
      measured.onModuleDestroy();
    });

    it("fetches identically with no observer bound", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("<html>ok</html>"));

      const result = await provider.fetchWithRetry("https://example.gov/x");

      expect(result.content).toContain("ok");
    });
  });
});
