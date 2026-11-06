/**
 * Random access to the entries of a downloaded ZIP, for `.lob` cells: a row
 * names another entry in the same archive that holds the cell's content
 * (`bills-phase-b.md`, D9).
 *
 * The central directory is read once and kept as a name → entry index, so each
 * lookup opens one entry rather than scanning the archive. Only names found in
 * that index can be read: a cell's value is never used as a filesystem path.
 */

import yauzl from "yauzl";

/**
 * Largest single entry read into memory. pubinfo's largest bill text was
 * 5.5 MB on 2026-11-05; anything far beyond that is not a bill and is refused
 * rather than buffered.
 */
export const MAX_LOB_BYTES = 32 * 1024 * 1024;

export interface ZipEntryReader {
  /** The entry's content as UTF-8; throws when the archive has no such entry. */
  read(name: string): Promise<string>;
  close(): void;
}

export function openZipEntryReader(zipPath: string): Promise<ZipEntryReader> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      // NOSONAR — entries are only indexed here; nothing is extracted to disk.
      if (err || !zip) {
        reject(err ?? new Error("Failed to open ZIP"));
        return;
      }
      const entries = new Map<string, yauzl.Entry>();
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve(readerFor(zip, entries)));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

function readerFor(
  zip: yauzl.ZipFile,
  entries: Map<string, yauzl.Entry>,
): ZipEntryReader {
  return {
    read(name) {
      const entry = entries.get(name);
      if (!entry) {
        return Promise.reject(new Error(`ZIP has no entry named ${name}`));
      }
      if (entry.uncompressedSize > MAX_LOB_BYTES) {
        return Promise.reject(
          new Error(
            `ZIP entry ${name} is ${entry.uncompressedSize} bytes, over the ${MAX_LOB_BYTES}-byte limit`,
          ),
        );
      }
      return readEntry(zip, entry);
    },
    close() {
      zip.close();
    },
  };
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Failed to open ZIP entry ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    });
  });
}
