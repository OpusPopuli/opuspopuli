import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  DataType,
  type DataSourceConfig,
  type XlsxSheetConfig,
} from '@opuspopuli/common';
import { parseXlsxGrid } from '@opuspopuli/scraping-pipeline';

/** One label with its interpreted numeric value, e.g. `Nevada` → 50,737. */
export interface SheetFact {
  label: string;
  value: number;
  /**
   * FIPS as the source states it, when it states one.
   *
   * Preferred over the label wherever present: matching on a code beats
   * requiring two publishers to spell "San Luis Obispo" the same way forever.
   */
  fips?: string;
}

/**
 * Per-county signature thresholds for a county initiative.
 *
 * Elections Code §9118 sets the requirement at 10% of the votes cast for ALL
 * gubernatorial candidates at the last gubernatorial general — not the
 * winner's total, and not registered voters. The denominator therefore comes
 * from the Secretary of State's Statement of Vote; the Report of Registration
 * supplies registered voters for display only.
 *
 * `signatures_required` is deliberately NOT stored. It is `ceil(votes * 0.10)`
 * and is derived in the query, so a stored copy cannot drift from the votes it
 * claims to describe.
 *
 * Source policy: the official statewide record for the cycle is authoritative.
 * County guides are cross-checks, not authority — Nevada County publishes
 * 51,370 gubernatorial votes, which the 2022 Statement of Vote does not
 * support and which most likely still describes 2018. Matching it would import
 * someone else's staleness and ship it as verified.
 */
@Injectable()
export class CountyThresholdSyncService {
  private readonly logger = new Logger(CountyThresholdSyncService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Read every configured county-threshold source, then write the counties.
   *
   * Aborts rather than writing a partial set: a county missing from the parse
   * renders as an unshaded polygon that looks like data, which is worse than
   * an obvious failure.
   */
  async sync(
    sources: DataSourceConfig[],
    stateCode: string,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const votes = this.pickSource(sources, 'sumAllValueColumns');
    const registration = this.pickSource(sources, 'valueColumn');

    if (!votes) {
      throw new Error(
        `No ${DataType.COUNTY_THRESHOLDS} source configured with xlsx.sumAllValueColumns — ` +
          'that source supplies the §9118 denominator and there is nothing to write without it',
      );
    }

    // Config validation before the fetch: a source that cannot produce a
    // usable row should not cost a download first, and the cycle is the one
    // fact the spreadsheet itself never states.
    if (!votes.bulk?.xlsx?.electionYear) {
      throw new Error(
        `CountyThresholds: ${votes.url} has no xlsx.electionYear; the §9118 ` +
          'denominator is meaningless without the cycle it describes',
      );
    }

    // Population comes from a flat Census file keyed by FIPS rather than a
    // pivot sheet keyed by name (#1131).
    const populationSource = sources.find(
      (s) => s.bulk?.csv?.field === 'population',
    );

    const voteFacts = await this.readSheet(votes);
    const registrationFacts = registration
      ? await this.readSheet(registration)
      : [];
    const populationFacts = populationSource
      ? await this.readDelimited(populationSource)
      : [];

    const fipsByName = await this.countyFipsByName(stateCode);
    return this.persist(
      votes,
      voteFacts,
      registration,
      registrationFacts,
      fipsByName,
      populationSource,
      populationFacts,
    );
  }

  /** Pick the source whose sheet config sets a given field. */
  private pickSource(
    sources: DataSourceConfig[],
    key: keyof XlsxSheetConfig,
  ): DataSourceConfig | undefined {
    return sources.find((s) => s.bulk?.xlsx?.[key] !== undefined);
  }

  /**
   * Fetch one spreadsheet and reduce it to label/value facts.
   *
   * The aggregate row named by `excludeLabels` is reconciled against the sum of
   * the members before being dropped. That check is what proves the parse read
   * every candidate column rather than the winner's — the failure mode that
   * silently understates every threshold by roughly half.
   */
  async readSheet(source: DataSourceConfig): Promise<SheetFact[]> {
    const cfg = source.bulk?.xlsx;
    if (!cfg) {
      throw new Error(`Source ${source.url} has no bulk.xlsx configuration`);
    }

    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(
        `Fetching ${source.url} failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const grid = parseXlsxGrid(
      Buffer.from(await response.arrayBuffer()),
      cfg.sheet ?? 1,
    );

    const labelColumn = cfg.labelColumn ?? 0;
    const skip = cfg.skipRowPattern ? new RegExp(cfg.skipRowPattern) : null;
    const excluded = new Set(cfg.excludeLabels ?? []);

    const facts: SheetFact[] = [];
    let aggregate: number | null = null;

    for (const row of grid) {
      const label = (row[labelColumn] ?? '').trim();
      if (!label || skip?.test(label)) continue;

      const value = this.rowValue(row, cfg, labelColumn);
      if (value === null) continue;

      if (excluded.has(label)) {
        aggregate = value;
        continue;
      }
      facts.push({ label, value });
    }

    this.reconcile(source.url, facts, aggregate, [...excluded]);
    return facts;
  }

  /**
   * Read a flat delimited file into facts keyed by FIPS.
   *
   * These files identify counties by code, so no name matching is involved —
   * `nameColumn` exists only to make an error message legible.
   */
  async readDelimited(source: DataSourceConfig): Promise<SheetFact[]> {
    const cfg = source.bulk?.csv;
    if (!cfg) {
      throw new Error(`Source ${source.url} has no bulk.csv configuration`);
    }

    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(
        `Fetching ${source.url} failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const rows = parseDelimited(text, source.bulk?.delimiter ?? ',');
    if (rows.length === 0) {
      throw new Error(`CountyThresholds: ${source.url} returned no rows`);
    }

    const header = rows[0];
    const indexOf = (column: string): number => {
      const i = header.indexOf(column);
      if (i < 0) {
        throw new Error(
          `CountyThresholds: ${source.url} has no column "${column}" — ` +
            `the file's header is [${header.slice(0, 12).join(', ')}...]. ` +
            'A renamed column must fail here rather than yield empty figures.',
        );
      }
      return i;
    };

    const fipsIndexes = cfg.fipsColumns.map(indexOf);
    const valueIndex = indexOf(cfg.valueColumn);
    const nameIndex = cfg.nameColumn ? indexOf(cfg.nameColumn) : -1;
    const filters = Object.entries(cfg.rowFilter ?? {}).map(
      ([column, expected]) => [indexOf(column), expected] as const,
    );

    const aggregateFilters = Object.entries(cfg.aggregateFilter ?? {}).map(
      ([column, expected]) => [indexOf(column), expected] as const,
    );

    const { facts, aggregate } = collectRows(rows.slice(1), {
      width: header.length,
      valueIndex,
      fipsIndexes,
      nameIndex,
      filters,
      aggregateFilters,
    });

    this.reconcile(
      source.url,
      facts,
      aggregate,
      Object.keys(cfg.aggregateFilter ?? {}),
    );
    this.logger.log(
      `CountyThresholds: ${source.url} yielded ${facts.length} ${cfg.field} row(s)`,
    );
    return facts;
  }

  /** Sum every numeric cell, or read the one configured column. */
  private rowValue(
    row: string[],
    cfg: XlsxSheetConfig,
    labelColumn: number,
  ): number | null {
    if (!cfg.sumAllValueColumns) {
      const raw = row[cfg.valueColumn ?? labelColumn + 1];
      const single = Number(raw);
      return raw !== undefined && raw !== '' && Number.isFinite(single)
        ? single
        : null;
    }

    let total = 0;
    let seen = false;
    for (let i = 0; i < row.length; i++) {
      if (i === labelColumn) continue;
      const cell = row[i];
      if (cell === undefined || cell === '') continue;
      const n = Number(cell);
      // A percent cell ("79.3%") is not a number, so a stray one cannot be
      // silently added into a vote total.
      if (!Number.isFinite(n)) return null;
      total += n;
      seen = true;
    }
    return seen ? total : null;
  }

  /** The members must add up to the file's own total, or the parse is wrong. */
  private reconcile(
    url: string,
    facts: SheetFact[],
    aggregate: number | null,
    expectedLabels: string[],
  ): void {
    if (aggregate === null) {
      // Declaring excludeLabels and matching none of them means the check you
      // asked for did not run — the label is wrong, or the file changed its
      // wording. Warning was not enough: California's two spreadsheets say
      // "State Totals" and "State Total", and a config that carried the plural
      // for both left the registration file unverified while looking fine, with
      // its total silently counted as a 59th county.
      if (expectedLabels.length > 0) {
        throw new Error(
          `CountyThresholds: ${url} declares excludeLabels ` +
            `[${expectedLabels.join(', ')}] but the sheet contains none of them, ` +
            'so the totals were never reconciled and an aggregate row may be ' +
            'counted as a member. Fix the label rather than shipping an unverified parse.',
        );
      }
      this.logger.warn(
        `CountyThresholds: ${url} has no aggregate row to reconcile against; ` +
          'the parse is unverified',
      );
      return;
    }
    const sum = facts.reduce((acc, f) => acc + f.value, 0);
    if (sum !== aggregate) {
      throw new Error(
        `CountyThresholds: ${url} does not reconcile — members sum to ${sum} ` +
          `but the file's own total row says ${aggregate}. The parse is reading the ` +
          'wrong columns; refusing to write figures that carry a legal requirement.',
      );
    }
    this.logger.log(
      `CountyThresholds: ${url} reconciles — ${facts.length} rows sum to ${aggregate}`,
    );
  }

  /** County display name → FIPS, for the rows already loaded as jurisdictions. */
  private async countyFipsByName(
    stateCode: string,
  ): Promise<Map<string, string>> {
    const counties = await this.db.jurisdiction.findMany({
      where: { type: 'COUNTY', stateCode },
      select: { name: true, fipsCode: true },
    });

    const byName = new Map<string, string>();
    for (const c of counties) {
      if (!c.fipsCode) continue;
      // Jurisdictions are named "Nevada County"; the spreadsheets say "Nevada".
      byName.set(normalizeCountyName(c.name), c.fipsCode);
    }
    return byName;
  }

  /** Write every county, or none. */
  private async persist(
    votesSource: DataSourceConfig,
    voteFacts: SheetFact[],
    registrationSource: DataSourceConfig | undefined,
    registrationFacts: SheetFact[],
    fipsByName: Map<string, string>,
    populationSource?: DataSourceConfig,
    populationFacts: SheetFact[] = [],
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const registrationByName = new Map(
      registrationFacts.map((f) => [normalizeCountyName(f.label), f.value]),
    );
    // Keyed by the code the source states, not by a name we have to match.
    const populationByFips = new Map(
      populationFacts
        .filter((f) => f.fips)
        .map((f) => [f.fips as string, f.value]),
    );
    const populationAsOf = populationSource?.bulk?.csv?.asOf;

    const missing = voteFacts
      .map((f) => f.label)
      .filter((label) => !fipsByName.has(normalizeCountyName(label)));
    if (missing.length > 0) {
      throw new Error(
        `CountyThresholds: no jurisdiction matches ${missing.length} county name(s): ` +
          `${missing.join(', ')}. Refusing to write a partial set — a county absent from ` +
          'the table renders as an unshaded polygon that reads as data.',
      );
    }

    const retrievedAt = new Date();
    // Guaranteed by the up-front check in sync().
    const year = votesSource.bulk!.xlsx!.electionYear!;
    const asOf = registrationSource?.bulk?.xlsx?.asOf;

    let created = 0;
    let updated = 0;
    for (const fact of voteFacts) {
      const name = normalizeCountyName(fact.label);
      const fips = fipsByName.get(name)!;
      const registered = registrationByName.get(name) ?? null;

      const population = populationByFips.get(fips) ?? null;

      const data = {
        gubernatorialVotes: fact.value,
        gubernatorialYear: year,
        registeredVoters: registered,
        registrationAsOf: asOf ? new Date(asOf) : null,
        population,
        // Cited only when there is a figure to cite: a source attached to a
        // null population claims provenance for nothing.
        populationSource:
          population === null ? null : (populationSource?.url ?? null),
        populationAsOf:
          population !== null && populationAsOf
            ? new Date(populationAsOf)
            : null,
        sourceUrl: votesSource.url,
        retrievedAt,
      };

      const existing = await this.db.countyThreshold.findUnique({
        where: { fips },
        select: { fips: true },
      });
      if (existing) {
        await this.db.countyThreshold.update({ where: { fips }, data });
        updated++;
      } else {
        await this.db.countyThreshold.create({ data: { fips, ...data } });
        created++;
      }
    }

    await this.materializeAdjacency();
    const withPopulation = voteFacts.filter((f) =>
      populationByFips.has(fipsByName.get(normalizeCountyName(f.label))!),
    ).length;
    if (populationSource && withPopulation < voteFacts.length) {
      // Partial population is not fatal — it is display-only and the rail
      // degrades to "not available" — but silence here is how 0 of 58 went
      // unnoticed until someone looked at the page (#1131).
      this.logger.warn(
        `CountyThresholds: population found for ${withPopulation}/${voteFacts.length} counties`,
      );
    }
    this.logger.log(
      `CountyThresholds: ${created} created, ${updated} updated (${year} cycle), ` +
        `${withPopulation} with population`,
    );
    return { created, updated, skipped: 0 };
  }

  /**
   * Rebuild `county_adjacency` from the loaded county geometry.
   *
   * Derived from `jurisdictions.boundary` rather than a published adjacency
   * file so it cannot disagree with the polygons the map draws. `ST_Touches`
   * is symmetric, so both directions are written and "who are my neighbours"
   * is a single-column lookup.
   */
  private async materializeAdjacency(): Promise<void> {
    const written = await this.db.$executeRaw`
      WITH pairs AS (
        SELECT a.fips_code AS fips, b.fips_code AS neighbor
        FROM jurisdictions a
        JOIN jurisdictions b
          ON a.type = 'COUNTY' AND b.type = 'COUNTY'
         AND a.id <> b.id
         AND a.boundary IS NOT NULL AND b.boundary IS NOT NULL
         AND ST_Touches(a.boundary::geometry, b.boundary::geometry)
        WHERE a.fips_code IS NOT NULL AND b.fips_code IS NOT NULL
      )
      INSERT INTO county_adjacency (fips, neighbor)
      SELECT fips, neighbor FROM pairs
      ON CONFLICT (fips, neighbor) DO NOTHING
    `;
    this.logger.log(`CountyThresholds: ${written} adjacency pair(s) written`);
  }
}

/**
 * Split delimited text into rows of fields, honouring quoted values.
 *
 * A bare `split(",")` corrupts any row with a quoted comma — and a population
 * figure attached to the wrong county is exactly the kind of error that looks
 * entirely plausible on a page.
 */
/** Column positions `collectRows` needs to interpret a row. */
interface RowPlan {
  width: number;
  valueIndex: number;
  fipsIndexes: number[];
  nameIndex: number;
  filters: readonly (readonly [number, string])[];
  aggregateFilters: readonly (readonly [number, string])[];
}

/**
 * Partition data rows from the publisher's own total row.
 *
 * Extracted from `readDelimited` so each stays legible: this decides what a
 * row IS, and the caller decides what to do about it.
 */
function collectRows(
  rows: string[][],
  plan: RowPlan,
): { facts: SheetFact[]; aggregate: number | null } {
  const facts: SheetFact[] = [];
  let aggregate: number | null = null;
  const matches = (
    row: string[],
    f: readonly (readonly [number, string])[],
  ): boolean => f.every(([i, expected]) => row[i] === expected);

  for (const row of rows) {
    if (row.length < plan.width) continue;

    const value = Number(row[plan.valueIndex]);
    if (!Number.isFinite(value)) continue;

    if (
      plan.aggregateFilters.length > 0 &&
      matches(row, plan.aggregateFilters)
    ) {
      aggregate = value;
      continue;
    }
    if (!matches(row, plan.filters)) continue;

    facts.push({
      fips: plan.fipsIndexes.map((i) => row[i]).join(''),
      label: plan.nameIndex >= 0 ? row[plan.nameIndex] : '',
      value,
    });
  }

  return { facts, aggregate };
}

/**
 * Consume one quoted field, starting just after its opening quote.
 *
 * Split out so `parseDelimited` stays a flat scan: the doubled-quote escape is
 * the only genuinely fiddly part of CSV, and it reads better alone.
 */
function readQuotedField(
  text: string,
  start: number,
): { value: string; next: number } {
  let value = '';
  let i = start;

  while (i < text.length) {
    const ch = text[i];
    if (ch !== '"') {
      value += ch;
      i++;
      continue;
    }
    // A doubled quote inside a quoted field is a literal quote.
    if (text[i + 1] === '"') {
      value += '"';
      i += 2;
      continue;
    }
    return { value, next: i + 1 };
  }
  return { value, next: i };
}

/**
 * Split delimited text into rows of fields, honouring quoted values.
 *
 * A bare `split(",")` corrupts any row with a quoted comma — and a population
 * figure attached to the wrong county is exactly the kind of error that looks
 * entirely plausible on a page.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      const quoted = readQuotedField(text, i + 1);
      field += quoted.value;
      i = quoted.next;
      continue;
    }

    if (ch === delimiter) endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
    i++;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * "Nevada County" and "Nevada" are the same place.
 *
 * The jurisdictions table carries the full display name; the state's
 * spreadsheets carry the bare one. Normalizing both sides means a future
 * "City and County of San Francisco" mismatch surfaces as a named error from
 * persist() rather than a county silently missing from the map.
 */
export function normalizeCountyName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+County$/i, '')
    .toLowerCase();
}
