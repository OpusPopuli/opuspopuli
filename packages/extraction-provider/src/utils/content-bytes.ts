import { createHash } from "node:crypto";

/** Leading UTF-8 byte-order mark (EF BB BF). */
const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Decode a fetched body as UTF-8, matching `Response.text()` exactly.
 *
 * This exists because content-addressing a source requires hashing the bytes
 * the server actually sent, which means reading the body as an ArrayBuffer and
 * decoding it ourselves rather than calling `response.text()`. That swap is
 * only safe if the decode is identical — a silent change in decode behaviour
 * would alter every scrape in the pipeline.
 *
 * Measured against `Response.text()` across plain ASCII, valid multibyte,
 * latin1 high bytes, a lone continuation byte and a truncated sequence:
 * `Buffer.toString("utf8")` agrees on all of them, including replacing invalid
 * sequences with U+FFFD. It differs in exactly one case — `Response.text()`
 * performs the spec's "UTF-8 decode", which **strips a leading BOM**, while
 * `Buffer.toString("utf8")` preserves it as U+FEFF. Left unhandled, every
 * BOM-prefixed page would gain an invisible leading character, which then
 * shifts every claim offset derived from that text by one (#1212).
 *
 * @param bytes - Raw response body
 * @returns The decoded text, BOM-stripped
 */
export function decodeUtf8(bytes: Buffer): string {
  const hasBom =
    bytes.length >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, i) => bytes[i] === byte);

  return hasBom
    ? bytes.subarray(UTF8_BOM.length).toString("utf8")
    : bytes.toString("utf8");
}

/**
 * SHA-256 of the raw response body, hex-encoded.
 *
 * Hashed over the bytes as received — before decoding, before any
 * normalisation — so the digest witnesses what the server sent rather than
 * what we made of it. This is the content address for `SourceVersion`
 * (#1276): an unchanged re-fetch produces the same hash and stores nothing.
 *
 * @param bytes - Raw response body
 * @returns Lowercase hex SHA-256 digest
 */
export function hashContentBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
