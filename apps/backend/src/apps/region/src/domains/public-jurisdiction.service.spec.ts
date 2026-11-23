import { Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import {
  GeocoderUnavailableError,
  type GeocodingService,
} from 'src/common/geocoding/geocoding.service';
import {
  LOCATE_BUDGETS,
  LOCATE_ERROR,
  PublicJurisdictionService,
} from './public-jurisdiction.service';

/**
 * The anonymous district lookup (#1456). What it must never do matters as
 * much as what it returns: keep, log or echo the address or location.
 */

const ADDRESS = {
  line1: '1315 10th Street',
  city: 'Sacramento',
  state: 'ca',
  postalCode: '95814',
};
const POINT = { lat: 38.576543, lng: -121.493712 };
/** Every value a visitor typed or shared: none may reach a log or an error. */
const SECRETS = [
  '1315 10th Street',
  '10th Street',
  '95814',
  '38.576543',
  '-121.493712',
];

const ROWS = [
  { id: 'j-county', name: 'Sacramento', type: 'COUNTY', parent: null },
];

function setup() {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'j-county' }]),
    jurisdiction: { findMany: jest.fn().mockResolvedValue(ROWS) },
  };
  const geocoder = {
    geocode: jest.fn().mockResolvedValue({
      latitude: POINT.lat,
      longitude: POINT.lng,
      formattedAddress: '',
    }),
  };
  const service = new PublicJurisdictionService(
    db as never,
    geocoder as unknown as GeocodingService,
  );
  return { db, geocoder, service };
}

/** Every argument any Logger method received, as one string. */
function loggedText(): string {
  return (['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const)
    .flatMap((level) =>
      (Logger.prototype[level] as unknown as jest.Mock).mock.calls.flat(),
    )
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join('\n');
}

async function caught(promise: Promise<unknown>): Promise<GraphQLError> {
  try {
    await promise;
  } catch (error) {
    return error as GraphQLError;
  }
  throw new Error('expected a rejection');
}

describe('PublicJurisdictionService (#1456)', () => {
  beforeEach(() => {
    for (const level of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function make() {
    const made = setup();
    return made;
  }

  it('resolves a point with one boundary query, then loads the rows with parents', async () => {
    const { db, geocoder, service } = make();
    await expect(
      service.locate({ point: POINT }, '198.51.100.1'),
    ).resolves.toBe(ROWS);
    expect(geocoder.geocode).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.jurisdiction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['j-county'] } },
        include: { parent: true },
      }),
    );
  });

  it('turns an address into a point, then resolves the point', async () => {
    const { db, geocoder, service } = make();
    await expect(
      service.locate({ address: ADDRESS }, '198.51.100.1'),
    ).resolves.toBe(ROWS);
    expect(geocoder.geocode).toHaveBeenCalledWith(
      ADDRESS.line1,
      ADDRESS.city,
      'CA',
      ADDRESS.postalCode,
    );
    // The geocoded point, bound as parameters, never interpolated.
    const [sql] = db.$queryRaw.mock.calls[0] as [{ values: unknown[] }];
    expect(sql.values).toEqual([POINT.lng, POINT.lat, POINT.lng, POINT.lat]);
  });

  it('answers an unknown address with no districts, not an error', async () => {
    const { db, geocoder, service } = make();
    geocoder.geocode.mockResolvedValue(null);
    await expect(
      service.locate({ address: ADDRESS }, '198.51.100.1'),
    ).resolves.toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('tells an unreachable geocoder apart from a bad address, without echoing it', async () => {
    const { geocoder, service } = make();
    geocoder.geocode.mockRejectedValue(
      new GeocoderUnavailableError('HTTP 503'),
    );
    const error = await caught(
      service.locate({ address: ADDRESS }, '198.51.100.1'),
    );
    expect(error.extensions.code).toBe(LOCATE_ERROR.UNAVAILABLE);
    for (const secret of SECRETS) expect(error.message).not.toContain(secret);
  });

  it.each([
    ['both', { point: POINT, address: ADDRESS }],
    ['neither', {}],
  ])('refuses %s a point and an address', async (_label, input) => {
    const { db, service } = make();
    const error = await caught(service.locate(input, '198.51.100.1'));
    expect(error.extensions.code).toBe(LOCATE_ERROR.INVALID);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('caps address lookups per IP, and not across IPs', async () => {
    const { geocoder, service } = make();
    const limit = LOCATE_BUDGETS.addressPerIpMinute.limit;
    for (let i = 0; i < limit; i++) {
      await service.locate({ address: ADDRESS }, '198.51.100.1');
    }
    const error = await caught(
      service.locate({ address: ADDRESS }, '198.51.100.1'),
    );
    expect(error.extensions.code).toBe(LOCATE_ERROR.RATE_LIMITED);
    expect(geocoder.geocode).toHaveBeenCalledTimes(limit);
    await expect(
      service.locate({ address: ADDRESS }, '198.51.100.2'),
    ).resolves.toBe(ROWS);
  });

  it('caps point lookups per IP', async () => {
    const { service } = make();
    for (let i = 0; i < LOCATE_BUDGETS.pointPerIpMinute.limit; i++) {
      await service.locate({ point: POINT }, '198.51.100.1');
    }
    const error = await caught(
      service.locate({ point: POINT }, '198.51.100.1'),
    );
    expect(error.extensions.code).toBe(LOCATE_ERROR.RATE_LIMITED);
  });

  it('logs nothing a visitor typed or shared, on any path', async () => {
    const { geocoder, service } = make();
    await service.locate({ point: POINT }, '198.51.100.1');
    await service.locate({ address: ADDRESS }, '198.51.100.1');
    geocoder.geocode.mockResolvedValueOnce(null);
    await service.locate({ address: ADDRESS }, '198.51.100.1');
    geocoder.geocode.mockRejectedValueOnce(
      new GeocoderUnavailableError('HTTP 503'),
    );
    await caught(service.locate({ address: ADDRESS }, '198.51.100.1'));
    await caught(
      service.locate({ point: POINT, address: ADDRESS }, '198.51.100.1'),
    );
    const text = loggedText();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('restores saved ids without duplicates, and asks nothing for none', async () => {
    const { db, service } = make();
    await expect(service.byIds([])).resolves.toEqual([]);
    expect(db.jurisdiction.findMany).not.toHaveBeenCalled();
    await service.byIds(['a', 'b', 'a']);
    expect(db.jurisdiction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a', 'b'] } } }),
    );
  });
});

describe('PublicJurisdictionService IPv6 budgets (#1456)', () => {
  it('counts address lookups per /48, so one home allocation cannot drain the geocoder', async () => {
    const { service } = setup();
    const limit = LOCATE_BUDGETS.addressPerIpMinute.limit;
    // A different /64 inside one /48 on every call.
    for (let i = 0; i < limit; i++) {
      await service.locate(
        { address: ADDRESS },
        `2001:db8:1:${i.toString(16)}::1`,
      );
    }
    const error = await caught(
      service.locate({ address: ADDRESS }, '2001:db8:1:ff::1'),
    );
    expect(error.extensions.code).toBe(LOCATE_ERROR.RATE_LIMITED);
  });
});
