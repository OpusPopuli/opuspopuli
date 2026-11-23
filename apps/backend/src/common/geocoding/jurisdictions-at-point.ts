import { Prisma, type DbService } from '@opuspopuli/relationaldb-provider';

/**
 * The point-in-boundary query, as sent (#690, #1456). Exported so the
 * integration test can EXPLAIN exactly this and assert the index is used.
 *
 * Two predicates, each doing one job:
 *
 * - `boundary && point::geography` is the **index** step. It is a
 *   bounding-box test in the column's own type, which
 *   `jurisdictions_boundary_gist_idx` (a GiST on `boundary`, from
 *   `spatial-indexes.sql`) can answer.
 * - `ST_Contains(boundary::geometry, point)` is the **exact** step, the same
 *   planar test the signed-in resolution always used. It runs only on the
 *   handful of candidates the index returns.
 *
 * The query this replaces had only the second predicate. The cast to
 * geometry meant no index applied, so it scanned every boundary polygon in
 * the state on every call: 285 ms locally, against 2.3 ms here.
 *
 * Why not `ST_Covers` in geography, which also uses the index: its edges are
 * geodesics, which bow away from the planar TIGER lines by up to about 20 m on
 * the longest boundary segments. It also counts a point exactly on an edge
 * as inside both neighbours. Both change answers for addresses on boundary
 * streets. Checked: this query matches the planar original on 3,893 points
 * (random, inside districts, on every vertex of three districts) and on 6,000
 * more at quarter points of the 2,000 longest boundary edges.
 */
export function jurisdictionsAtPointSql(lat: number, lng: number): Prisma.Sql {
  return Prisma.sql`
    SELECT id
    FROM jurisdictions
    WHERE boundary && ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      AND ST_Contains(
        boundary::geometry,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      )
  `;
}

/**
 * Ids of every jurisdiction whose boundary contains a point. The one place
 * this lookup is made: both the signed-in address resolution and the
 * anonymous lookup call it.
 */
export async function jurisdictionIdsAtPoint(
  db: DbService,
  lat: number,
  lng: number,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(
    jurisdictionsAtPointSql(lat, lng),
  );
  return rows.map((row) => row.id);
}
