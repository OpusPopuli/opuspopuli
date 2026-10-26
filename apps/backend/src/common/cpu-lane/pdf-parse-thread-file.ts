import { join } from 'node:path';
import { envInt } from '@opuspopuli/common';
import type {
  PdfParseThreadRequest,
  PdfParseThreadResult,
} from './pdf-parse.thread';

export type { PdfParseThreadRequest, PdfParseThreadResult };

/**
 * The compiled thread script, beside this module in the build. Nothing
 * imports the script for its code — a thread loads it by path — so the
 * type-only import above is also what keeps it in `nest build --tsc`'s
 * program, and therefore in `dist/`.
 */
export const PDF_PARSE_THREAD_FILE = join(__dirname, 'pdf-parse.thread.js');

/**
 * Longest one parse may take on its thread before the thread is terminated
 * (`PDF_PARSE_THREAD_TIMEOUT_MS`, default 5 min). Read by the consumer that
 * enforces it and by the requester, which waits this long for a parse it
 * finds already running.
 */
export function pdfParseThreadTimeoutMs(): number {
  return envInt('PDF_PARSE_THREAD_TIMEOUT_MS', 5 * 60 * 1000);
}
