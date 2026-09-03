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

    const voteFacts = await this.readSheet(votes);
    const registrationFacts = registration
      ? await this.readSheet(registration)
      : [];

    const fipsByName = await this.countyFipsByName(stateCode);
    return this.persist(
      votes,
      voteFacts,
      registration,
      registrationFacts,
      fipsByName,
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

    this.reconcile(source.url, facts, aggregate);
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
  ): void {
    if (aggregate === null) {
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
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const registrationByName = new Map(
      registrationFacts.map((f) => [normalizeCountyName(f.label), f.value]),
    );

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

      const data = {
        gubernatorialVotes: fact.value,
        gubernatorialYear: year,
        registeredVoters: registered,
        registrationAsOf: asOf ? new Date(asOf) : null,
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
    this.logger.log(
      `CountyThresholds: ${created} created, ${updated} updated (${year} cycle)`,
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
