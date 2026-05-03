import { Logger } from "@nestjs/common";
import { PDFParse } from "pdf-parse";

/**
 * Structural type for the OCR dependency. Defined here rather than imported
 * from `@opuspopuli/ocr-provider` so this package stays runtime-decoupled
 * from OCR's transitive dep tree (`@nestjs/config`, etc.). Any service that
 * exposes an `extractFromBuffer(buffer, mimeType)` method satisfies the
 * contract — `OcrService` from `@opuspopuli/ocr-provider` does, but this
 * type doesn't require importing it.
 */
export interface IOcrProviderForPdf {
  extractFromBuffer(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ text: string }>;
}

/**
 * Tiered PDF text extractor.
 *
 * Many government PDFs (especially older scanned legislative archives) defeat
 * pure text-extraction libraries. The CA SOS qualified-ballot-measures page
 * for instance links to PDFs where pdf-parse returns only page-marker
 * boilerplate (~80 chars) and mupdf returns ~4 chars (just newlines) — the
 * actual measure body is a scanned image with no text layer.
 *
 * Strategy:
 *   1. **pdf-parse** (fast, ~95% of well-formed PDFs)
 *   2. **mupdf** text extraction (handles malformed/unusual encodings; same
 *      library is reused in tier 3 for rasterization, so adding it as the
 *      tier-2 fallback costs nothing extra)
 *   3. **mupdf rasterization → OCR per page** (image-based PDFs; slow —
 *      ~1-5s per page on Tesseract — and only invoked when the cheaper
 *      tiers fail to produce meaningful text)
 *
 * Each tier is gated by `looksMeaningful`, not just exception-catching:
 * pdf-parse for the SCA 1 case returns successfully with junk, so a pure
 * try/catch fallback would never fire.
 */
export class PdfExtractor {
  private static readonly logger = new Logger(PdfExtractor.name);

  /**
   * Tier-1 → tier-3 cascade. Returns the first meaningful result. If all
   * tiers fail and OCR is unavailable, returns the best-effort tier-2
   * output (which may be empty / junk) — callers should treat short
   * results as "no analyzable content."
   */
  static async extract(
    buffer: Buffer,
    ocrService?: IOcrProviderForPdf,
  ): Promise<string> {
    // Tier 1: pdf-parse
    const t1 = await PdfExtractor.tryPdfParse(buffer);
    if (looksMeaningful(t1)) {
      return t1;
    }
    PdfExtractor.logger.debug(
      `pdf-parse returned ${t1?.length ?? 0} chars (insufficient); trying mupdf text`,
    );

    // Tier 2: mupdf text extraction
    const t2 = await PdfExtractor.tryMupdfText(buffer);
    if (looksMeaningful(t2)) {
      PdfExtractor.logger.debug(
        `mupdf text recovered ${t2.length} chars where pdf-parse failed`,
      );
      return t2;
    }
    PdfExtractor.logger.debug(
      `mupdf text returned ${t2?.length ?? 0} chars (insufficient); trying OCR`,
    );

    // Tier 3: mupdf rasterize → OCR
    if (!ocrService) {
      PdfExtractor.logger.warn(
        "PDF needs OCR but no OcrService injected — returning best-effort text",
      );
      return t2 || t1 || "";
    }
    const startMs = Date.now();
    try {
      const ocrText = await PdfExtractor.tryMupdfOcr(buffer, ocrService);
      const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
      if (looksMeaningful(ocrText)) {
        PdfExtractor.logger.warn(
          `OCR recovered ${ocrText.length} chars from PDF in ${elapsedSec}s — image-based PDF`,
        );
        return ocrText;
      }
      PdfExtractor.logger.warn(
        `OCR returned ${ocrText?.length ?? 0} chars (insufficient) after ${elapsedSec}s`,
      );
      return ocrText || t2 || t1 || "";
    } catch (err) {
      PdfExtractor.logger.warn(
        `OCR failed: ${(err as Error).message} — returning best-effort text`,
      );
      return t2 || t1 || "";
    }
  }

  private static async tryPdfParse(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text ?? "";
    } catch (err) {
      PdfExtractor.logger.debug(`pdf-parse threw: ${(err as Error).message}`);
      return "";
    }
  }

  private static async tryMupdfText(buffer: Buffer): Promise<string> {
    try {
      const mupdf = await import("mupdf");
      const doc = mupdf.Document.openDocument(buffer, "application/pdf");
      const pageCount = doc.countPages();
      const pages: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        pages.push(page.toStructuredText("preserve-whitespace").asText());
      }
      return pages.join("\n");
    } catch (err) {
      PdfExtractor.logger.debug(
        `mupdf text extraction threw: ${(err as Error).message}`,
      );
      return "";
    }
  }

  /**
   * Rasterize each page to PNG via mupdf, then OCR each PNG via the
   * injected OcrService. Tesseract supports image MIME types only, so the
   * rasterization step is mandatory for image-based PDFs.
   *
   * 200 DPI is the OCR quality / speed sweet spot — higher gives marginal
   * accuracy gains at meaningful runtime cost.
   */
  private static async tryMupdfOcr(
    buffer: Buffer,
    ocrService: IOcrProviderForPdf,
  ): Promise<string> {
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(buffer, "application/pdf");
    const pageCount = doc.countPages();
    const dpi = 200;
    const matrix = mupdf.Matrix.scale(dpi / 72, dpi / 72);
    const pageTexts: string[] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);
      const png = pixmap.asPNG();
      const result = await ocrService.extractFromBuffer(
        Buffer.from(png),
        "image/png",
      );
      pageTexts.push(result.text);
    }

    return pageTexts.join("\n");
  }
}

/**
 * Heuristic for "this looks like real PDF text content, not extraction junk."
 *
 * Real bills are thousands of characters with substantive prose. Junk
 * extractions (page-marker boilerplate, blank pages, unparseable fonts) tend
 * to produce either very short output OR output that's mostly whitespace +
 * page numbers.
 *
 * The threshold is deliberately conservative — we'd rather invoke a slower
 * tier on a borderline case than persist a useless extraction.
 */
export function looksMeaningful(text: string | undefined | null): boolean {
  if (!text) return false;
  if (text.length < 200) return false;
  // Strip "-- N of M --" page markers and any whitespace; require at least
  // 100 chars of substantive content remaining.
  const substantive = text
    .replaceAll(/--\s*\d+\s*of\s*\d+\s*--/g, "")
    .replaceAll(/\s+/g, "");
  return substantive.length >= 100;
}
