/**
 * ShapesBuilderService's decisions, with the database mocked: when it
 * builds, skips or keeps the previous shapes, and which sources it accepts.
 * The SQL itself is exercised against PostGIS in
 * __tests__/integration/region/shapes-builder.integration.spec.ts.
 */
import type { BoundarySourcesConfig } from '@opuspopuli/region-provider';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { REGION_FRAME, ShapesBuilderService } from './shapes-builder.service';

const square = (x: number, size = 1000) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + size, 0],
        [x + size, size],
        [x, size],
        [x, 0],
      ],
    ],
  });

const DISPLAY = {
  url: 'https://maps.example.gov/arcgis/rest/services/Generalized/Counties/MapServer',
  layerName: 'Counties (generalised)',
};
const countyLayer = (display = DISPLAY) => ({
  layer: 'Counties/MapServer',
  outFields: 'GEOID,NAME',
  jurisdictionType: 'COUNTY' as const,
  level: 'COUNTY' as const,
  nameField: 'NAME',
  display,
});
const REGION: BoundarySourcesConfig = {
  ocdIdPrefix: 'ocd-division/country:zz',
  displayProjection: 3857,
  tigerLayers: [countyLayer()],
};
const districtsOf = (url: string): BoundarySourcesConfig => ({
  ocdIdPrefix: 'ocd-division/country:zz/county:a',
  geoportalLayers: [
    {
      url,
      outFields: 'NUM',
      jurisdictionType: 'COUNTY_SUPERVISOR_DISTRICT',
      level: 'COUNTY',
      nameField: 'NUM',
      fipsPrefix: 'sup-99001-',
    },
  ],
});
const COUNTIES = [
  districtsOf(
    'https://gis.a.example.gov/arcgis/rest/services/D/FeatureServer/0',
  ),
];

interface World {
  complete: Array<{ type: string; missing: number; with_display: number }>;
  drawn: string[];
  projected: Array<{
    id: string;
    type: string;
    fips_code: string;
    geom: string;
  }>;
  districts: Array<{
    county_id: string;
    id: string;
    fips_code: string;
    geom: string;
    gap: number;
    overlap: number;
  }>;
  fingerprint: string | null;
  locked: boolean;
}

function makeDb(world: World) {
  const sqlOf = (args: unknown[]) => (args[0] as string[]).join('?');
  const route = (...args: unknown[]) => {
    const sql = sqlOf(args);
    if (sql.includes('AS missing')) return Promise.resolve(world.complete);
    if (sql.includes('SELECT DISTINCT j.type')) {
      return Promise.resolve(world.drawn.map((type) => ({ type })));
    }
    if (sql.includes('WITH c AS')) return Promise.resolve(world.districts);
    if (sql.includes('display_boundary::geometry'))
      return Promise.resolve(world.projected);
    return Promise.reject(new Error(`unexpected SQL: ${sql}`));
  };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ locked: world.locked }])),
    shapeFrame: { deleteMany: jest.fn(), createMany: jest.fn() },
    jurisdictionShape: { createMany: jest.fn() },
  };
  const db = {
    $queryRaw: jest.fn(route),
    shapeFrame: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          world.fingerprint ? { fingerprint: world.fingerprint } : null,
        ),
      ),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<boolean>) => fn(tx)),
  };
  return { db, tx };
}

const twoCounties = (): World => ({
  complete: [{ type: 'COUNTY', missing: 0, with_display: 2 }],
  drawn: [],
  projected: [
    { id: 'a', type: 'COUNTY', fips_code: '99001', geom: square(0) },
    { id: 'b', type: 'COUNTY', fips_code: '99003', geom: square(1000) },
  ],
  districts: [
    {
      county_id: 'a',
      id: 'a-1',
      fips_code: 'sup-99001-1',
      geom: square(0, 500),
      gap: 0.75,
      overlap: 0,
    },
  ],
  fingerprint: null,
  locked: true,
});

describe('ShapesBuilderService (#1475)', () => {
  const builderFor = (world: World) => {
    const { db, tx } = makeDb(world);
    return {
      builder: new ShapesBuilderService(db as unknown as DbService),
      db,
      tx,
    };
  };

  it('builds a region frame and a frame per county, with the region fingerprinted', async () => {
    const { builder, tx } = builderFor(twoCounties());

    const result = await builder.build(REGION, COUNTIES);

    expect(result).toEqual({
      frames: 3,
      shapes: 2 + 2 + 1,
      incompleteTypes: [],
    });
    const frames = tx.shapeFrame.createMany.mock.calls[0][0].data;
    const region = frames.find(
      (f: { frameKey: string }) => f.frameKey === REGION_FRAME,
    );
    expect(region.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const countyA = frames.find(
      (f: { jurisdictionId: string }) => f.jurisdictionId === 'a',
    );
    expect(countyA).toMatchObject({ gapShare: 0.75, bestEffort: true });
    const countyB = frames.find(
      (f: { jurisdictionId: string }) => f.jurisdictionId === 'b',
    );
    expect(countyB).toMatchObject({
      gapShare: null,
      bestEffort: null,
      fingerprint: null,
    });
  });

  it('skips when the inputs match the fingerprint the shapes were built from', async () => {
    const first = builderFor(twoCounties());
    await first.builder.build(REGION, COUNTIES);
    const fingerprint =
      first.tx.shapeFrame.createMany.mock.calls[0][0].data.find(
        (f: { frameKey: string }) => f.frameKey === REGION_FRAME,
      ).fingerprint;

    const { builder, tx } = builderFor({ ...twoCounties(), fingerprint });
    const result = await builder.build(REGION, COUNTIES);

    expect(result.skipped).toBe('up-to-date');
    expect(tx.shapeFrame.deleteMany).not.toHaveBeenCalled();
  });

  it('rebuilds when a source changes in config, without being forced', async () => {
    const first = builderFor(twoCounties());
    await first.builder.build(REGION, COUNTIES);
    const fingerprint =
      first.tx.shapeFrame.createMany.mock.calls[0][0].data.find(
        (f: { frameKey: string }) => f.frameKey === REGION_FRAME,
      ).fingerprint;

    const moved = {
      ...REGION,
      tigerLayers: [countyLayer({ ...DISPLAY, layerName: 'Counties v2' })],
    };
    const { builder } = builderFor({ ...twoCounties(), fingerprint });
    const result = await builder.build(moved, COUNTIES);

    expect(result.frames).toBe(3);
  });

  it('keeps the previous shapes rather than drop a layer it already draws', async () => {
    const { builder, tx } = builderFor({
      ...twoCounties(),
      complete: [{ type: 'COUNTY', missing: 1, with_display: 2 }],
      drawn: ['COUNTY'],
    });

    const result = await builder.build(REGION, COUNTIES, { force: true });

    expect(result).toMatchObject({
      skipped: 'would-drop-built',
      incompleteTypes: ['COUNTY'],
    });
    expect(tx.shapeFrame.deleteMany).not.toHaveBeenCalled();
  });

  it('counts a layer complete only when no row with a boundary lacks display geometry', async () => {
    const { builder } = builderFor({
      ...twoCounties(),
      // Totals would balance (one row each way); per row, one is missing.
      complete: [{ type: 'COUNTY', missing: 1, with_display: 2 }],
    });

    const result = await builder.build(REGION, COUNTIES);

    expect(result.incompleteTypes).toEqual(['COUNTY']);
    expect(result.frames).toBe(0);
  });

  it('skips when another service holds the replace lock', async () => {
    const { builder, tx } = builderFor({ ...twoCounties(), locked: false });

    const result = await builder.build(REGION, COUNTIES);

    expect(result.skipped).toBe('busy');
    expect(tx.shapeFrame.deleteMany).not.toHaveBeenCalled();
  });

  it('draws no county frames for a region without a county layer', async () => {
    const senate = {
      ...REGION,
      tigerLayers: [
        {
          ...countyLayer(),
          jurisdictionType: 'STATE_SENATE_DISTRICT' as const,
        },
      ],
    };
    const { builder, db } = builderFor({
      ...twoCounties(),
      complete: [
        { type: 'STATE_SENATE_DISTRICT', missing: 0, with_display: 1 },
      ],
      projected: [
        {
          id: 's1',
          type: 'STATE_SENATE_DISTRICT',
          fips_code: 'sldu-99001',
          geom: square(0),
        },
      ],
    });

    const result = await builder.build(senate, COUNTIES);

    expect(result.frames).toBe(1);
    const sql = db.$queryRaw.mock.calls.map((c) =>
      (c[0] as unknown as string[]).join('?'),
    );
    expect(sql.some((q) => q.includes('WITH c AS'))).toBe(false);
  });

  it('leaves out one degenerate county instead of failing the build', async () => {
    const world = twoCounties();
    world.projected.push({
      id: 'z',
      type: 'COUNTY',
      fips_code: '99099',
      geom: JSON.stringify({ type: 'Polygon', coordinates: [] }),
    });
    const { builder, tx } = builderFor(world);

    const result = await builder.build(REGION, COUNTIES);

    const frames = tx.shapeFrame.createMany.mock.calls[0][0].data;
    expect(
      frames.map((f: { jurisdictionId: string | null }) => f.jurisdictionId),
    ).toEqual(expect.arrayContaining([null, 'a', 'b']));
    expect(
      frames.map((f: { jurisdictionId: string | null }) => f.jurisdictionId),
    ).not.toContain('z');
    expect(result.frames).toBe(3);
  });

  it('measures districts only from configured layers, and skips the query without any', async () => {
    const { builder, db } = builderFor(twoCounties());
    await builder.build(REGION, COUNTIES);
    const clip = db.$queryRaw.mock.calls.find((c) =>
      (c[0] as unknown as string[]).join('?').includes('WITH c AS'),
    );
    expect(clip).toContainEqual(['sup-99001-']);

    const none = builderFor(twoCounties());
    await none.builder.build(REGION, []);
    const queried = none.db.$queryRaw.mock.calls.some((c) =>
      (c[0] as unknown as string[]).join('?').includes('WITH c AS'),
    );
    expect(queried).toBe(false);
  });

  it('leaves out a district no configured layer accounts for', async () => {
    const world = twoCounties();
    world.districts.push({
      county_id: 'a',
      id: 'stray',
      fips_code: 'other-1',
      geom: square(500, 500),
      gap: 0,
      overlap: 0,
    });
    const { builder, tx } = builderFor(world);

    await builder.build(REGION, COUNTIES);

    const shapes = tx.jurisdictionShape.createMany.mock.calls[0][0].data;
    expect(
      shapes.map((s: { jurisdictionId: string }) => s.jurisdictionId),
    ).not.toContain('stray');
  });

  it.each([
    ['not HTTPS', 'http://maps.example.gov/MapServer'],
    ['a script URL', 'javascript:alert(1)'],
    ['malformed', 'not a url'],
  ])(
    'drops a display source that is %s, rather than serve it',
    async (_label, url) => {
      const { builder } = builderFor(twoCounties());

      const result = await builder.build(
        { ...REGION, tigerLayers: [countyLayer({ ...DISPLAY, url })] },
        COUNTIES,
      );

      expect(result.skipped).toBe('no-display-layers');
    },
  );

  it('drops a malformed district source without failing the build', async () => {
    const { builder, tx } = builderFor(twoCounties());

    const result = await builder.build(REGION, [districtsOf('::::')]);

    expect(result.frames).toBe(3);
    const shapes = tx.jurisdictionShape.createMany.mock.calls[0][0].data;
    expect(
      shapes.map((s: { jurisdictionId: string }) => s.jurisdictionId),
    ).not.toContain('a-1');
  });

  it('keeps the previous shapes when no layer is complete', async () => {
    const { builder, tx } = builderFor({
      ...twoCounties(),
      complete: [{ type: 'COUNTY', missing: 0, with_display: 0 }],
    });

    const result = await builder.build(REGION, COUNTIES);

    expect(result).toMatchObject({ frames: 0, incompleteTypes: ['COUNTY'] });
    expect(tx.shapeFrame.deleteMany).not.toHaveBeenCalled();
  });

  it('builds nothing without a projection or a display layer', async () => {
    const { builder } = builderFor(twoCounties());

    expect(
      (
        await builder.build(
          { ...REGION, displayProjection: undefined },
          COUNTIES,
        )
      ).skipped,
    ).toBe('no-projection');
    expect(
      (
        await builder.build(
          {
            ...REGION,
            tigerLayers: [{ ...countyLayer(), display: undefined }],
          },
          COUNTIES,
        )
      ).skipped,
    ).toBe('no-display-layers');
  });
});
