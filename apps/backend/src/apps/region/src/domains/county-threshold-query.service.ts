import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type {
  CheapestNeighborModel,
  CountyThresholdModel,
} from './models/county-threshold.model';

/** Elections Code §9118: 10% of votes cast for all gubernatorial candidates. */
const COUNTY_INITIATIVE_RATE = 0.1;

/** The county fields the read path needs, before derivation. */
interface ThresholdRow {
  fips: string;
  name: string;
  gubernatorialVotes: number;
  gubernatorialYear: number;
  registeredVoters: number | null;
  population: number | null;
  sourceUrl: string;
  retrievedAt: Date;
}

/**
 * Read side for county thresholds.
 *
 * Every figure a consumer sees is derived here rather than stored, so a
 * rendered number cannot disagree with the vote total it claims to come from.
 * See #1106 for why `signatures_required` is deliberately absent from the
 * table.
 *
 * Public records only. This service must never join to user, signup or
 * activation data — epic #1105, criterion 9.
 */
@Injectable()
export class CountyThresholdQueryService {
  constructor(private readonly db: DbService) {}

  /** ceil, because a fractional signature is not a thing and rounding down
   *  would understate a legal requirement. */
  static signaturesFor(gubernatorialVotes: number): number {
    return Math.ceil(gubernatorialVotes * COUNTY_INITIATIVE_RATE);
  }

  /**
   * All counties with thresholds, cheapest first.
   *
   * Ordered by the derived requirement rather than by name, because the
   * question the page answers is "where is this achievable" — and it makes
   * `rank` a position in the returned list rather than a second sort.
   */
  async findAll(): Promise<CountyThresholdModel[]> {
    const rows = await this.db.$queryRaw<ThresholdRow[]>`
      SELECT t.fips,
             j.name,
             t.gubernatorial_votes  AS "gubernatorialVotes",
             t.gubernatorial_year   AS "gubernatorialYear",
             t.registered_voters    AS "registeredVoters",
             t.population,
             t.source_url           AS "sourceUrl",
             t.retrieved_at         AS "retrievedAt"
      FROM county_thresholds t
      JOIN jurisdictions j ON j.fips_code = t.fips
      ORDER BY t.gubernatorial_votes ASC, j.name ASC
    `;

    const signaturesByFips = new Map(
      rows.map((r) => [
        r.fips,
        CountyThresholdQueryService.signaturesFor(r.gubernatorialVotes),
      ]),
    );
    const nameByFips = new Map(rows.map((r) => [r.fips, r.name]));
    const cheapest = await this.cheapestNeighbors(signaturesByFips, nameByFips);

    return rows.map((row, index) => {
      const signaturesRequired = signaturesByFips.get(row.fips)!;
      return {
        ...row,
        signaturesRequired,
        shareOfRegistered: row.registeredVoters
          ? signaturesRequired / row.registeredVoters
          : null,
        // Rows are ordered by the same value rank expresses, so position is
        // the rank. 1-based because "rank 0" reads as an error, not a winner.
        rank: index + 1,
        cheapestNeighbor: cheapest.get(row.fips) ?? null,
      };
    });
  }

  /**
   * For each county, the adjacent county needing the fewest signatures.
   *
   * One query for every edge, resolved in memory against figures already
   * derived above — 58 counties and 288 edges, so a per-county query would be
   * 58 round trips to answer a question one round trip already contains.
   */
  private async cheapestNeighbors(
    signaturesByFips: Map<string, number>,
    nameByFips: Map<string, string>,
  ): Promise<Map<string, CheapestNeighborModel>> {
    const edges = await this.db.countyAdjacency.findMany({
      select: { fips: true, neighbor: true },
    });

    const best = new Map<string, CheapestNeighborModel>();
    for (const edge of edges) {
      const signaturesRequired = signaturesByFips.get(edge.neighbor);
      const name = nameByFips.get(edge.neighbor);
      // An edge can point at a county with no threshold row yet; skip rather
      // than reporting a neighbour whose figure we cannot state.
      if (signaturesRequired === undefined || name === undefined) continue;

      const current = best.get(edge.fips);
      if (!current || signaturesRequired < current.signaturesRequired) {
        best.set(edge.fips, {
          fips: edge.neighbor,
          name,
          signaturesRequired,
        });
      }
    }
    return best;
  }
}
