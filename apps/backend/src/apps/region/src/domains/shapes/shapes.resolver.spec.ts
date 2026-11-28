import { JurisdictionTypeGQL } from '../models/jurisdiction.model';
import { ShapesResolver } from './shapes.resolver';
import type { ShapesQueryService } from './shapes-query.service';

describe('ShapesResolver (#1475)', () => {
  const query = {
    regionShapes: jest
      .fn()
      .mockResolvedValue({ viewBox: [0, 0, 1000, 900], shapes: [] }),
    countyShapes: jest.fn().mockResolvedValue(null),
  };
  const resolver = new ShapesResolver(query as unknown as ShapesQueryService);

  it('passes the requested layers through', async () => {
    await expect(
      resolver.regionShapes({ types: [JurisdictionTypeGQL.COUNTY] }),
    ).resolves.toEqual({ viewBox: [0, 0, 1000, 900], shapes: [] });
    expect(query.regionShapes).toHaveBeenCalledWith([
      JurisdictionTypeGQL.COUNTY,
    ]);
  });

  it('returns null for a county with no shapes', async () => {
    await expect(resolver.countyShapes({ fips: '99999' })).resolves.toBeNull();
    expect(query.countyShapes).toHaveBeenCalledWith('99999');
  });
});
