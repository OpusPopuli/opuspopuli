import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

/**
 * Minimal .xlsx sheet reader — returns a grid of cell strings and nothing more.
 *
 * Deliberately dumb. It does not map columns to domain fields the way
 * `BulkDownloadConfig.columnMappings` does for TSV/CSV, because the official
 * spreadsheets this exists for are **pivot-shaped**: California's Statement of
 * Vote carries one header row of candidate names, a second of party codes, and
 * one column per candidate, with a `Percent` row interleaved after every county.
 * "Sum across every candidate column" is domain knowledge — it belongs in the
 * region handler that knows what a candidate is, not in a config field invented
 * to hold it. So the pipeline stops at the grid.
 *
 * No new dependency: .xlsx is a ZIP of XML, and `adm-zip` + `cheerio` are
 * already here for the ZIP/TSV and HTML paths.
 */

/** A parsed worksheet: `grid[rowIndex][columnIndex]`, empty cells as "". */
export type SheetGrid = string[][];

/**
 * Translate a cell reference's column letters to a 0-based index —
 * `A` → 0, `Z` → 25, `AA` → 26.
 *
 * Cells are addressed by reference rather than by position, and a row omits
 * empty cells entirely. Reading them in document order would silently shift
 * every value left of a gap into the wrong column, which for a vote table
 * means attributing one candidate's count to another.
 */
export function columnIndexFromRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
  if (!letters) return -1;

  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Shared-string table; `t="s"` cells hold an index into it, not a value. */
function readSharedStrings(zip: AdmZip): string[] {
  const entry = zip.getEntry("xl/sharedStrings.xml");
  if (!entry) return [];

  const $ = cheerio.load(zip.readAsText(entry), { xmlMode: true });
  return $("si")
    .toArray()
    .map((si) =>
      $(si)
        .find("t")
        .toArray()
        .map((t) => $(t).text())
        .join(""),
    );
}

/**
 * Read one worksheet into a grid of strings.
 *
 * @param buffer raw .xlsx bytes
 * @param sheet  1-based sheet number (default 1)
 */
export function parseXlsxGrid(buffer: Buffer, sheet = 1): SheetGrid {
  const zip = new AdmZip(buffer);
  const path = `xl/worksheets/sheet${sheet}.xml`;
  const entry = zip.getEntry(path);
  if (!entry) {
    const available = zip
      .getEntries()
      .map((e) => e.entryName)
      .filter((n) => n.startsWith("xl/worksheets/"));
    throw new Error(
      `xlsx: ${path} not found. Worksheets present: ${available.join(", ") || "none"}`,
    );
  }

  const shared = readSharedStrings(zip);
  const $ = cheerio.load(zip.readAsText(entry), { xmlMode: true });

  return $("row")
    .toArray()
    .map((row) => {
      const cells: string[] = [];
      for (const c of $(row).find("c").toArray()) {
        const $c = $(c);
        const index = columnIndexFromRef($c.attr("r") ?? "");
        const value = cellValue($, $c, shared);
        if (index < 0) {
          cells.push(value);
          continue;
        }
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }
      return cells;
    });
}

function cellValue(
  $: cheerio.CheerioAPI,
  $c: ReturnType<cheerio.CheerioAPI>,
  shared: string[],
): string {
  const type = $c.attr("t");

  // Inline strings carry their text directly rather than via the shared table.
  if (type === "inlineStr") return $c.find("is t").text();

  const raw = $c.find("v").first().text();
  if (raw === "") return "";
  if (type !== "s") return raw;

  const index = Number(raw);
  return Number.isInteger(index) ? (shared[index] ?? "") : "";
}
