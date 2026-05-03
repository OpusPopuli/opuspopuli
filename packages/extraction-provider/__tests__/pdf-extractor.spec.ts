import { PdfExtractor, looksMeaningful } from "../src/utils/pdf-extractor.js";

// Mock pdf-parse and mupdf at module level so we can drive every tier of
// the cascade independently. The PdfExtractor uses dynamic `await import("mupdf")`
// for tiers 2/3, so we mock the module here.

const pdfParseGetText = jest.fn();
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: pdfParseGetText,
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mupdfPageText = jest.fn();
const mupdfPageRender = jest.fn();
const buildMupdfPage = (i: number) => ({
  toStructuredText: () => ({ asText: () => mupdfPageText(i) }),
  toPixmap: () => ({ asPNG: () => mupdfPageRender(i) }),
});
const buildMupdfDocument = () => ({
  countPages: () => 2,
  loadPage: buildMupdfPage,
});
jest.mock("mupdf", () => ({
  Document: {
    openDocument: jest.fn().mockImplementation(buildMupdfDocument),
  },
  Matrix: { scale: jest.fn().mockReturnValue({}) },
  ColorSpace: { DeviceRGB: {} },
}));

const REAL_PROSE =
  "Senator Smith introduces this measure to amend Section 10 of Article II of the California Constitution. " +
  "It establishes new requirements for ballot measure approval thresholds. " +
  "The amendment specifies that any subsequent measure proposing to raise voter approval thresholds " +
  "must itself meet the same heightened threshold to take effect.";

const buf = Buffer.from("dummy-pdf-bytes");

describe("looksMeaningful", () => {
  it("rejects null / undefined / empty", () => {
    expect(looksMeaningful(null)).toBe(false);
    expect(looksMeaningful(undefined)).toBe(false);
    expect(looksMeaningful("")).toBe(false);
  });

  it("rejects text shorter than 200 chars", () => {
    expect(looksMeaningful("a".repeat(199))).toBe(false);
    expect(looksMeaningful("short bio")).toBe(false);
  });

  it("rejects pure page-marker boilerplate even at length", () => {
    // Real SCA 1 case: 80 chars of "-- N of M --" page markers. Pad with
    // newlines to push past the 200-char gate but still no real content.
    const junk =
      "\n".repeat(150) +
      "-- 1 of 5 --\n-- 2 of 5 --\n-- 3 of 5 --\n-- 4 of 5 --\n-- 5 of 5 --\n";
    expect(junk.length).toBeGreaterThan(200);
    expect(looksMeaningful(junk)).toBe(false);
  });

  it("accepts real prose", () => {
    expect(looksMeaningful(REAL_PROSE)).toBe(true);
  });

  it("accepts text with embedded page markers when there's substantive content", () => {
    expect(looksMeaningful(REAL_PROSE + "\n-- 1 of 5 --\n")).toBe(true);
  });
});

describe("PdfExtractor.extract — tier cascade", () => {
  beforeEach(() => {
    pdfParseGetText.mockReset();
    mupdfPageText.mockReset();
    mupdfPageRender.mockReset();
  });

  it("tier 1: returns pdf-parse output when meaningful", async () => {
    pdfParseGetText.mockResolvedValue({ text: REAL_PROSE });
    const result = await PdfExtractor.extract(buf);
    expect(result).toBe(REAL_PROSE);
    expect(mupdfPageText).not.toHaveBeenCalled();
  });

  it("tier 1 → tier 2: falls through to mupdf when pdf-parse returns junk", async () => {
    pdfParseGetText.mockResolvedValue({
      text: "\n".repeat(150) + "-- 1 of 5 --\n-- 2 of 5 --\n",
    });
    mupdfPageText.mockReturnValueOnce(REAL_PROSE).mockReturnValueOnce("");
    const result = await PdfExtractor.extract(buf);
    expect(result).toContain(REAL_PROSE);
    expect(mupdfPageText).toHaveBeenCalledTimes(2);
  });

  it("tier 1 → tier 2: falls through when pdf-parse throws", async () => {
    pdfParseGetText.mockRejectedValue(new Error("malformed pdf"));
    mupdfPageText.mockReturnValueOnce(REAL_PROSE).mockReturnValueOnce("");
    const result = await PdfExtractor.extract(buf);
    expect(result).toContain(REAL_PROSE);
  });

  it("tier 2 → tier 3: falls through when mupdf text extraction throws", async () => {
    pdfParseGetText.mockResolvedValue({ text: "" });
    mupdfPageText.mockImplementation(() => {
      throw new Error("mupdf font decode error");
    });
    mupdfPageRender.mockReturnValue(Buffer.from("png-bytes"));
    const ocrService = {
      extractFromBuffer: jest.fn().mockResolvedValue({ text: REAL_PROSE }),
    } as never;

    const result = await PdfExtractor.extract(buf, ocrService);
    expect(result).toContain(REAL_PROSE);
  });

  it("tier 1 → tier 2 → tier 3 (OCR): rasterizes + OCRs each page when both text tiers fail", async () => {
    pdfParseGetText.mockResolvedValue({ text: "" });
    mupdfPageText.mockReturnValue("");
    mupdfPageRender
      .mockReturnValueOnce(Buffer.from("page1-png-bytes"))
      .mockReturnValueOnce(Buffer.from("page2-png-bytes"));

    const ocrService = {
      extractFromBuffer: jest
        .fn()
        .mockResolvedValueOnce({ text: REAL_PROSE })
        .mockResolvedValueOnce({ text: "" }),
    } as never;

    const result = await PdfExtractor.extract(buf, ocrService);
    expect(result).toContain(REAL_PROSE);
    // OCR was called once per page
    expect(
      (ocrService as { extractFromBuffer: jest.Mock }).extractFromBuffer,
    ).toHaveBeenCalledTimes(2);
    // Each call got a PNG buffer + image/png MIME
    expect(
      (ocrService as { extractFromBuffer: jest.Mock }).extractFromBuffer,
    ).toHaveBeenNthCalledWith(1, expect.any(Buffer), "image/png");
  });

  it("tier 3 missing (no OcrService injected): returns best-effort tier-2 text", async () => {
    pdfParseGetText.mockResolvedValue({ text: "" });
    mupdfPageText.mockReturnValue("\n");
    const result = await PdfExtractor.extract(buf);
    // Whatever tier 2 produced (junk), returned rather than throwing
    expect(typeof result).toBe("string");
  });

  it("tier 3 throws: returns best-effort tier-2 text instead of bubbling up", async () => {
    pdfParseGetText.mockResolvedValue({ text: "" });
    mupdfPageText.mockReturnValue("");
    mupdfPageRender.mockReturnValue(Buffer.from("png-bytes"));
    const ocrService = {
      extractFromBuffer: jest
        .fn()
        .mockRejectedValue(new Error("tesseract crashed")),
    } as never;

    const result = await PdfExtractor.extract(buf, ocrService);
    expect(typeof result).toBe("string"); // does not throw
  });

  it("tier 3 returns junk: degrades gracefully", async () => {
    pdfParseGetText.mockResolvedValue({ text: "" });
    mupdfPageText.mockReturnValue("");
    mupdfPageRender.mockReturnValue(Buffer.from("png-bytes"));
    const ocrService = {
      extractFromBuffer: jest.fn().mockResolvedValue({ text: "" }),
    } as never;

    const result = await PdfExtractor.extract(buf, ocrService);
    expect(typeof result).toBe("string");
  });
});
