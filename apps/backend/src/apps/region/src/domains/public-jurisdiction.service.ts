import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { GraphQLError } from 'graphql';
import {
  GeocoderUnavailableError,
  GeocodingService,
} from 'src/common/geocoding/geocoding.service';
import { jurisdictionIdsAtPoint } from 'src/common/geocoding/jurisdictions-at-point';
import { FixedWindowThrottlerStorage } from 'src/common/rate-limit/fixed-window-storage';
import { rateLimitKey } from 'src/common/utils/client-ip';
import type {
  AddressLookupInput,
  GeoPointInput,
  LocateJurisdictionsInput,
} from './dto/locate-jurisdictions.input';

export type JurisdictionWithParent = Prisma.JurisdictionGetPayload<{
  include: { parent: true };
}>;

/** A per-key budget: at most `limit` lookups per `ttl` milliseconds. */
interface Budget {
  readonly name: string;
  readonly limit: number;
  readonly ttl: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Budgets for anonymous lookups, tighter than page reads (#1456). An address
 * costs a call to the US Census geocoder, a free public service we must not
 * hammer, so it gets its own per-IP budget and a global hourly cap. A point
 * costs one indexed PostGIS query.
 */
export const LOCATE_BUDGETS = {
  addressPerIpMinute: { name: 'addr-ip-min', limit: 10, ttl: MINUTE },
  addressPerIpHour: { name: 'addr-ip-hour', limit: 60, ttl: HOUR },
  geocoderGlobalHour: { name: 'geocoder-global', limit: 2000, ttl: HOUR },
  pointPerIpMinute: { name: 'point-ip-min', limit: 30, ttl: MINUTE },
} as const satisfies Record<string, Budget>;

/** The visitor-facing error codes; the frontend tells these cases apart. */
export const LOCATE_ERROR = {
  INVALID: 'BAD_USER_INPUT',
  RATE_LIMITED: 'TOO_MANY_REQUESTS',
  UNAVAILABLE: 'LOCATION_SERVICE_UNAVAILABLE',
} as const;

function locateError(message: string, code: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

/**
 * Finds a visitor's districts without an account, and keeps nothing (#1456).
 *
 * The address or point is used for one lookup and dropped. It is never
 * written to the database, cached, logged or put in an error message. The
 * geocoder logs a failure with the locality only (#1094), and this service
 * logs nothing at all. The caller stores the returned ids on the visitor's
 * own device, and restores them later through {@link byIds}.
 *
 * The resolution is the same PostGIS containment the signed-in path uses
 * (`JurisdictionResolutionService`). Every California jurisdiction type has a
 * boundary, so a point resolves completely. An address only needs turning
 * into a point first.
 */
@Injectable()
export class PublicJurisdictionService {
  /** In-memory budgets: one gateway and one region instance per node. */
  private readonly budgets = new FixedWindowThrottlerStorage();

  constructor(
    private readonly db: DbService,
    private readonly geocoder: GeocodingService,
  ) {}

  async locate(
    input: LocateJurisdictionsInput,
    clientIp: string | undefined,
  ): Promise<JurisdictionWithParent[]> {
    if (input.point && !input.address) {
      const client = rateLimitKey(clientIp);
      await this.spend(`point:${client}`, LOCATE_BUDGETS.pointPerIpMinute);
      return this.atPoint(input.point);
    }
    if (input.address && !input.point) {
      // Per /48 for IPv6: the geocoder budget is shared by everyone, and a
      // home allocation's 256 /64s must not add up to all of it.
      const subscriber = rateLimitKey(clientIp, 48);
      await this.spend(`addr:${subscriber}`, LOCATE_BUDGETS.addressPerIpMinute);
      await this.spend(`addr:${subscriber}`, LOCATE_BUDGETS.addressPerIpHour);
      await this.spend('geocoder', LOCATE_BUDGETS.geocoderGlobalHour);
      return this.atAddress(input.address);
    }
    throw locateError(
      'Give exactly one of a location or an address.',
      LOCATE_ERROR.INVALID,
    );
  }

  /** Rebuild districts from ids a visitor's device kept. Unknown ids drop out. */
  async byIds(ids: readonly string[]): Promise<JurisdictionWithParent[]> {
    if (ids.length === 0) return [];
    return this.db.jurisdiction.findMany({
      where: { id: { in: [...new Set(ids)] } },
      include: { parent: true },
      orderBy: [{ level: 'asc' }, { type: 'asc' }, { name: 'asc' }],
    });
  }

  private async atAddress(
    address: AddressLookupInput,
  ): Promise<JurisdictionWithParent[]> {
    let result;
    try {
      result = await this.geocoder.geocode(
        address.line1,
        address.city,
        address.state.toUpperCase(),
        address.postalCode,
      );
    } catch (error) {
      if (error instanceof GeocoderUnavailableError) {
        throw locateError(
          'We could not look up addresses just now. Try again, or use your location.',
          LOCATE_ERROR.UNAVAILABLE,
        );
      }
      throw error;
    }
    // No such address is an answer, not a failure: no districts.
    if (!result) return [];
    return this.atPoint({ lat: result.latitude, lng: result.longitude });
  }

  private async atPoint(
    point: GeoPointInput,
  ): Promise<JurisdictionWithParent[]> {
    return this.byIds(
      await jurisdictionIdsAtPoint(this.db, point.lat, point.lng),
    );
  }

  private async spend(key: string, budget: Budget): Promise<void> {
    const record = await this.budgets.increment(
      `${budget.name}:${key}`,
      budget.ttl,
      budget.limit,
      budget.ttl,
      budget.name,
    );
    if (record.isBlocked) {
      throw locateError(
        'Too many lookups. Please wait a moment and try again.',
        LOCATE_ERROR.RATE_LIMITED,
      );
    }
  }
}
