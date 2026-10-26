/**
 * The S6 CPU lane's thread script: a PDF's bytes in, its parse out. Runs the
 * same cascade `ExtractionProvider` runs in process (pdf-parse → mupdf →
 * raster + OCR), with an OCR service built from the same env `OcrModule`
 * reads, so a parse made here keys identically. No Nest, no database: the
 * consumer that owns this pool loads the bytes and records the result.
 *
 * Imports packages only — no `src/` path aliases, which a thread cannot
 * resolve.
 */
import { parentPort } from 'node:worker_threads';
import { PdfExtractor, stripNulBytes } from '@opuspopuli/extraction-provider';
import { createTesseractOcrServiceFromEnv } from '@opuspopuli/ocr-provider';

/** One parse: the PDF's bytes, transferred, not copied. */
export interface PdfParseThreadRequest {
  bytes: ArrayBuffer;
}

/** The cascade's output, as `PdfExtractor.extractWithOutcome` reports it. */
export interface PdfParseThreadResult {
  text: string;
  complete: boolean;
}

const ocr = createTesseractOcrServiceFromEnv();

// Loaded: from here a death is the document's, not the script's (ThreadPool).
parentPort?.postMessage({ ready: true });

parentPort?.on(
  'message',
  async ({ id, payload }: { id: number; payload: PdfParseThreadRequest }) => {
    try {
      const parsed = await PdfExtractor.extractWithOutcome(
        Buffer.from(payload.bytes),
        ocr,
      );
      parentPort?.postMessage({
        id,
        ok: true,
        result: {
          text: stripNulBytes(parsed.text),
          complete: parsed.complete,
        } satisfies PdfParseThreadResult,
      });
    } catch (error) {
      parentPort?.postMessage({
        id,
        ok: false,
        error: (error as Error).message,
      });
    }
  },
);
