import { Injectable, Logger } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

interface SpatialJurisdictionRow {
  id: string;
  name: string;
  type: string;
  level: string;
}

type ResolutionSource = 'census_geocoder' | 'postgis';

/**
 * Resolves all civic jurisdictions for a geocoded address and persists them
 * to user_jurisdictions.
 *
 * Two resolution sources:
 *  1. census_geocoder — string district fields already written to UserAddress
 *     are matched to Jurisdiction rows by name + type.
 *  2. postgis — point-in-polygon query against loaded boundary geometries,
 *     catching everything Census doesn't return (special districts, etc.).
 *
 * Results are merged, deduplicated, and upserted. Safe to call multiple times
 * for the same address.
 */
@Injectable()
export class JurisdictionResolutionService {
  private readonly logger = new Logger(JurisdictionResolutionService.name);

  constructor(private readonly db: DbService) {}

  async resolveForAddress(
    userId: string,
    userAddressId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const [censusIds, postgisIds] = await Promise.all([
      this.resolveCensusJurisdictions(userAddressId),
      this.resolvePostgisJurisdictions(lat, lng),
    ]);

    const censusSet = new Map<string, ResolutionSource>(
      censusIds.map((id) => [id, 'census_geocoder']),
    );
    const postgisSet = new Map<string, ResolutionSource>(
      postgisIds.map((id) => [id, 'postgis']),
    );

    // Merge: PostGIS wins on resolvedBy if both sources return the same jurisdiction
    const merged = new Map<string, ResolutionSource>([
      ...censusSet,
      ...postgisSet,
    ]);

    if (merged.size === 0) {
      this.logger.debug(
        `No jurisdictions resolved for address ${userAddressId}`,
      );
      return;
    }

    await this.replaceJurisdictions(userId, userAddressId, merged);

    this.logger.log(
      `Resolved ${merged.size} jurisdictions for address ${userAddressId} ` +
        `(census: ${censusIds.length}, postgis: ${postgisIds.length})`,
    );
  }

  /**
   * Look up Jurisdiction rows matching the string district fields already
   * written to the UserAddress record by the Census Geocoder.
   */
  private async resolveCensusJurisdictions(
    userAddressId: string,
  ): Promise<string[]> {
    const address = await this.db.userAddress.findUnique({
      where: { id: userAddressId },
      select: {
        congressionalDistrict: true,
        stateSenatorialDistrict: true,
        stateAssemblyDistrict: true,
        county: true,
        municipality: true,
        schoolDistrict: true,
        state: true,
      },
    });

    if (!address) return [];

    const candidates = buildCensusCandidates(address);
    if (candidates.length === 0) return [];

    const found = await this.db.jurisdiction.findMany({
      where: { OR: candidates },
      select: { id: true },
    });

    return found.map((j) => j.id);
  }

  /**
   * Point-in-polygon query against loaded boundary geometries.
   * Returns all jurisdiction ids whose boundary contains (lat, lng).
   */
  private async resolvePostgisJurisdictions(
    lat: number,
    lng: number,
  ): Promise<string[]> {
    try {
      const rows = await this.db.$queryRaw<SpatialJurisdictionRow[]>`
        SELECT id, name, type, level
        FROM jurisdictions
        WHERE ST_Contains(
          boundary::geometry,
          ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)
        )
      `;
      return rows.map((r) => r.id);
    } catch (err) {
      // Boundary table may be empty before the ETL script is run
      this.logger.debug(
        `PostGIS jurisdiction query skipped: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async replaceJurisdictions(
    userId: string,
    userAddressId: string,
    jurisdictions: Map<string, ResolutionSource>,
  ): Promise<void> {
    const now = new Date();
    const rows = Array.from(jurisdictions.entries()).map(
      ([jurisdictionId, resolvedBy]) => ({
        id: crypto.randomUUID(),
        userId,
        userAddressId,
        jurisdictionId,
        resolvedBy,
        resolvedAt: now,
      }),
    );

    // Atomic delete-then-insert: prevents stale accumulation when an address
    // changes location, and prevents duplicates from concurrent geocoding calls.
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM user_jurisdictions WHERE user_address_id = ${userAddressId}
      `;

      await tx.$executeRaw`
        INSERT INTO user_jurisdictions
          (id, user_id, user_address_id, jurisdiction_id, resolved_by, resolved_at)
        SELECT
          (elem->>'id')::text,
          (elem->>'userId')::text,
          (elem->>'userAddressId')::text,
          (elem->>'jurisdictionId')::text,
          (elem->>'resolvedBy')::text,
          (elem->>'resolvedAt')::timestamptz
        FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS elem
      `;
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

type CensusAddressFields = {
  congressionalDistrict: string | null;
  stateSenatorialDistrict: string | null;
  stateAssemblyDistrict: string | null;
  county: string | null;
  municipality: string | null;
  schoolDistrict: string | null;
  state: string;
};

type JurisdictionWhereInput = Prisma.JurisdictionWhereInput;

/**
 * Build OR conditions to match Census string values against Jurisdiction rows.
 * Each entry pairs a district name with its expected JurisdictionType so we
 * don't accidentally match a city named "Alameda County" to a COUNTY row.
 */
function buildCensusCandidates(
  address: CensusAddressFields,
): JurisdictionWhereInput[] {
  const stateCode = address.state?.toUpperCase() ?? '';
  const candidates: JurisdictionWhereInput[] = [];

  const add = (
    name: string | null,
    type: Prisma.EnumJurisdictionTypeFilter | string,
  ) => {
    if (name) {
      candidates.push({
        name: { equals: name, mode: 'insensitive' },
        type: type as Prisma.EnumJurisdictionTypeFilter,
        stateCode,
      });
    }
  };

  add(address.congressionalDistrict, 'CONGRESSIONAL_DISTRICT');
  add(address.stateSenatorialDistrict, 'STATE_SENATE_DISTRICT');
  add(address.stateAssemblyDistrict, 'STATE_ASSEMBLY_DISTRICT');
  add(address.county, 'COUNTY');
  add(address.municipality, 'CITY');

  if (address.schoolDistrict) {
    candidates.push({
      name: { equals: address.schoolDistrict, mode: 'insensitive' },
      type: {
        in: [
          'SCHOOL_DISTRICT_UNIFIED',
          'SCHOOL_DISTRICT_ELEMENTARY',
          'SCHOOL_DISTRICT_HIGH',
        ],
      },
      stateCode,
    });
  }

  return candidates;
}
