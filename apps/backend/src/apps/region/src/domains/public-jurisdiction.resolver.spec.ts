import 'reflect-metadata';
import { AUDIT_METADATA_KEY } from 'src/common/decorators/audit.decorator';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PublicJurisdictionResolver } from './public-jurisdiction.resolver';
import type { PublicJurisdictionService } from './public-jurisdiction.service';

const PARENT = {
  id: 'j-ca',
  name: 'California',
  type: 'STATE',
  level: 'STATE',
  stateCode: 'CA',
  fipsCode: '06',
  ocdId: null,
  parentId: null,
};
const ROW = {
  id: 'j-county',
  name: 'Sacramento',
  type: 'COUNTY',
  level: 'COUNTY',
  stateCode: 'CA',
  fipsCode: null,
  ocdId: 'ocd-division/country:us/state:ca/county:sacramento',
  parentId: 'j-ca',
  parent: PARENT,
};

describe('PublicJurisdictionResolver (#1456)', () => {
  const service = {
    locate: jest.fn().mockResolvedValue([ROW]),
    byIds: jest.fn().mockResolvedValue([ROW]),
  };
  const resolver = new PublicJurisdictionResolver(
    service as unknown as PublicJurisdictionService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('is open to visitors without an account', () => {
    for (const handler of [
      resolver.locateJurisdictions,
      resolver.jurisdictionsByIds,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    }
  });

  it('keeps the lookup out of the audit log, whose records carry arguments', () => {
    // Both: restored ids are the visitor's location too, and a row would
    // pair them with the visitor's IP.
    for (const handler of [
      resolver.locateJurisdictions,
      resolver.jurisdictionsByIds,
    ]) {
      expect(Reflect.getMetadata(AUDIT_METADATA_KEY, handler)).toEqual({
        skipAudit: true,
      });
    }
  });

  it('passes the resolved client IP, never a client-chosen first hop', async () => {
    await resolver.locateJurisdictions({ point: { lat: 1, lng: 2 } }, {
      req: {
        headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.20' },
      },
    } as never);
    expect(service.locate).toHaveBeenCalledWith(
      { point: { lat: 1, lng: 2 } },
      '198.51.100.20',
    );
  });

  it('returns nullable columns as absent fields, parent included', async () => {
    const [model] = await resolver.jurisdictionsByIds({ ids: ['j-county'] });
    expect(model.fipsCode).toBeUndefined();
    expect(model.ocdId).toBe(ROW.ocdId);
    expect(model.parent).toEqual(
      expect.objectContaining({ id: 'j-ca', fipsCode: '06', ocdId: undefined }),
    );
  });
});
