/**
 * ShapesBuilderService against a real PostGIS database (#1475).
 *
 * The builder's SQL — projecting, clipping districts to a county outline,
 * assigning them to counties by interior point, and measuring gaps and
 * overlaps — only means anything when PostGIS runs it, so these tests insert
 * fixture geometry into `postgres_test` and read back what was written.
 *
 * The region is made up: two counties near 10°E 10°N, drawn in Web
 * Mercator. Nothing here depends on any real region's data.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { BoundarySourcesConfig } from '@opuspopuli/region-provider';
import {
  REGION_FRAME,
  ShapesBuilderService,
  countyFrameKey,
} from '../../../src/apps/region/src/domains/shapes/shapes-builder.service';
import { ShapesQueryService } from '../../../src/apps/region/src/domains/shapes/shapes-query.service';
import { JurisdictionTypeGQL } from '../../../src/apps/region/src/domains/models/jurisdiction.model';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

type Ring = Array<[number, number]>;

// The shared border between counties A and B: a zig-zag at 10.5°E, so
// simplification has vertices to remove and two independently simplified
// copies would drift apart.
const ZIGZAG: Ring = Array.from({ length: 51 }, (_, i) => [
  10.5 + (i % 2 === 0 ? 0 : 0.002),
  10 + i * 0.01,
]);

const COUNTY_A: Ring = [[10, 10], ...ZIGZAG, [10, 10.5], [10, 10]];
const COUNTY_B: Ring = [
  [11, 10],
  [11, 10.5],
  ...[...ZIGZAG].reverse(),
  [11, 10],
];
const rect = (x0: number, x1: number, y0 = 10, y1 = 10.5): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

const polygon = (ring: Ring) =>
  JSON.stringify({ type: 'Polygon', coordinates: [ring] });

const DISPLAY = {
  url: 'https://maps.example.gov/arcgis/rest/services/Generalized/Counties/MapServer',
  layerName: 'Counties (generalised)',
};

const REGION: BoundarySourcesConfig = {
  ocdIdPrefix: 'ocd-division/country:zz',
  displayProjection: 3857,
  tigerLayers: [
    {
      layer: 'Counties/MapServer',
      layerName: 'Counties',
      outFields: 'GEOID,NAME',
      jurisdictionType: 'COUNTY',
      level: 'COUNTY',
      nameField: 'NAME',
      display: DISPLAY,
    },
  ],
};

const districtsOf = (prefix: string, host: string): BoundarySourcesConfig => ({
  ocdIdPrefix: `ocd-division/country:zz/county:${prefix}`,
  geoportalLayers: [
    {
      url: `https://${host}/arcgis/rest/services/Districts/FeatureServer/0`,
      outFields: 'NUM',
      jurisdictionType: 'COUNTY_SUPERVISOR_DISTRICT',
      level: 'COUNTY',
      nameField: 'NUM',
      fipsField: 'NUM',
      fipsPrefix: `sup-${prefix}-`,
    },
  ],
});
const COUNTIES = [
  districtsOf('99001', 'gis.a.example.gov'),
  districtsOf('99003', 'gis.b.example.gov'),
];

describe('ShapesBuilderService — integration (#1475)', () => {
  let db: DbService;
  let builder: ShapesBuilderService;
  let query: ShapesQueryService;

  async function insert(
    id: string,
    type: string,
    fipsCode: string,
    boundary: Ring,
    display: Ring | null,
  ): Promise<void> {
    await db.$executeRaw`
      INSERT INTO jurisdictions (id, name, type, level, state_code, fips_code, boundary, updated_at)
      VALUES (
        ${id}, ${id}, ${type}::"JurisdictionType", 'COUNTY'::"JurisdictionLevel", 'ZZ', ${fipsCode},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${polygon(boundary)}::text), 4326))::geography,
        now()
      )
    `;
    if (display) {
      await db.$executeRaw`
UPDATE jurisdictions
           SET display_boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${polygon(display)}::text), 4326))::geography,
               display_source = ${DISPLAY.url}
         WHERE id = ${id}
      `;
    }
  }

  async function seedRegion(): Promise<void> {
    await insert('county-a', 'COUNTY', '99001', COUNTY_A, COUNTY_A);
    await insert('county-b', 'COUNTY', '99003', COUNTY_B, COUNTY_B);
    // A: two districts that overlap by a 0.05° strip, 10% of the county.
    await insert(
      'a-1',
      'COUNTY_SUPERVISOR_DISTRICT',
      'sup-99001-1',
      rect(9.99, 10.3),
      null,
    );
    await insert(
      'a-2',
      'COUNTY_SUPERVISOR_DISTRICT',
      'sup-99001-2',
      rect(10.25, 10.51),
      null,
    );
    // B: two districts that tile it exactly.
    await insert(
      'b-1',
      'COUNTY_SUPERVISOR_DISTRICT',
      'sup-99003-1',
      rect(10.5, 10.75),
      null,
    );
    await insert(
      'b-2',
      'COUNTY_SUPERVISOR_DISTRICT',
      'sup-99003-2',
      rect(10.75, 11),
      null,
    );
  }

  /** Vertices of an `M x y x y … Z` path, as "x,y" strings. */
  const vertices = (d: string): string[] => {
    const out: string[] = [];
    for (const ring of d.split('Z').filter(Boolean)) {
      const n = ring.replace('M', '').trim().split(' ').map(Number);
      for (let i = 0; i < n.length; i += 2) out.push(`${n[i]},${n[i + 1]}`);
    }
    return out;
  };

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShapesBuilderService,
        ShapesQueryService,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    builder = module.get(ShapesBuilderService);
    query = module.get(ShapesQueryService);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('builds a region frame and one frame per county, each shape with its source', async () => {
    await seedRegion();

    const result = await builder.build(REGION, COUNTIES);

    expect(result).toEqual({
      frames: 3,
      shapes: 2 + 3 + 3,
      incompleteTypes: [],
    });
    const frames = await db.shapeFrame.findMany({
      orderBy: { frameKey: 'asc' },
    });
    expect(frames.map((f) => f.frameKey)).toEqual([
      countyFrameKey('county-a'),
      countyFrameKey('county-b'),
      REGION_FRAME,
    ]);
    frames.forEach((f) => {
      expect(f.projectionSrid).toBe(3857);
      expect(f.viewBox).toHaveLength(4);
      expect(f.viewBox[2]).toBe(1000);
    });
    const regionShapes = await db.jurisdictionShape.findMany({
      where: { frameKey: REGION_FRAME },
    });
    regionShapes.forEach((s) => {
      expect(s.sourceUrl).toBe(DISPLAY.url);
      expect(s.sourceName).toBe(DISPLAY.layerName);
      expect(s.path).toMatch(/^M[\d ]+Z/);
    });
    const district = await db.jurisdictionShape.findFirstOrThrow({
      where: { jurisdictionId: 'a-1' },
    });
    expect(district.sourceName).toBe('gis.a.example.gov');
  });

  it('keeps a shared border identical in both neighbours after simplification', async () => {
    await seedRegion();
    await builder.build(REGION, COUNTIES);

    const [a, b] = await Promise.all(
      ['county-a', 'county-b'].map((id) =>
        db.jurisdictionShape.findUniqueOrThrow({
          where: {
            frameKey_jurisdictionId: {
              frameKey: REGION_FRAME,
              jurisdictionId: id,
            },
          },
        }),
      ),
    );
    const bVertices = new Set(vertices(b.path));
    const bWest = Math.min(
      ...vertices(b.path).map((v) => Number(v.split(',')[0])),
    );
    // Every vertex of A at or east of B's westernmost point lies on the
    // shared border; each must be one of B's vertices too.
    const aBorder = vertices(a.path).filter(
      (v) => Number(v.split(',')[0]) >= bWest,
    );
    expect(aBorder.length).toBeGreaterThan(1);
    aBorder.forEach((v) => expect(bVertices).toContain(v));
  });

  it('flags a county whose districts overlap, and not one whose districts tile it', async () => {
    await seedRegion();
    await builder.build(REGION, COUNTIES);

    const a = await db.shapeFrame.findUniqueOrThrow({
      where: { frameKey: countyFrameKey('county-a') },
    });
    const b = await db.shapeFrame.findUniqueOrThrow({
      where: { frameKey: countyFrameKey('county-b') },
    });
    expect(a.bestEffort).toBe(true);
    expect(a.overlapShare).toBeGreaterThan(0.05);
    expect(b.bestEffort).toBe(false);
    expect(b.gapShare).toBeLessThan(0.001);
    expect(b.overlapShare).toBeLessThan(0.001);
  });

  it('clips a district to its county, and leaves out one no config layer accounts for', async () => {
    await seedRegion();
    // A district for county B that no configured layer's prefix matches.
    await insert(
      'stray',
      'COUNTY_SUPERVISOR_DISTRICT',
      'other-1',
      rect(10.6, 10.7),
      null,
    );

    await builder.build(REGION, COUNTIES);

    expect(
      await db.jurisdictionShape.count({ where: { jurisdictionId: 'stray' } }),
    ).toBe(0);
    // a-1 starts west of county A (9.99°E); clipped, it can't reach past the outline.
    const frame = await db.shapeFrame.findUniqueOrThrow({
      where: { frameKey: countyFrameKey('county-a') },
    });
    const outline = await db.jurisdictionShape.findUniqueOrThrow({
      where: {
        frameKey_jurisdictionId: {
          frameKey: frame.frameKey,
          jurisdictionId: 'county-a',
        },
      },
    });
    const a1 = await db.jurisdictionShape.findUniqueOrThrow({
      where: {
        frameKey_jurisdictionId: {
          frameKey: frame.frameKey,
          jurisdictionId: 'a-1',
        },
      },
    });
    const minX = (d: string) =>
      Math.min(...vertices(d).map((v) => Number(v.split(',')[0])));
    expect(minX(a1.path)).toBeGreaterThanOrEqual(minX(outline.path));
  });

  it('leaves a layer out, and the previous shapes in place, when some of it lacks display geometry', async () => {
    await seedRegion();
    await builder.build(REGION, COUNTIES);
    const before = await db.jurisdictionShape.count();

    // A third county with a boundary but no display geometry yet.
    await insert('county-c', 'COUNTY', '99005', rect(11, 11.5), null);
    const result = await builder.build(REGION, COUNTIES, { force: true });

    expect(result.incompleteTypes).toEqual(['COUNTY']);
    expect(result.frames).toBe(0);
    expect(await db.jurisdictionShape.count()).toBe(before);
  });

  it('skips when shapes exist, unless forced', async () => {
    await seedRegion();
    await builder.build(REGION, COUNTIES);

    expect((await builder.build(REGION, COUNTIES)).skipped).toBe('up-to-date');
    expect(
      (await builder.build(REGION, COUNTIES, { force: true })).frames,
    ).toBe(3);
  });

  it('draws a layer whose uncovered rows were checked, but not the rows themselves', async () => {
    await seedRegion();
    // A county the display source was checked for and doesn't cover.
    await insert('county-w', 'COUNTY', '99007', rect(11, 11.5), null);
    await db.$executeRaw`UPDATE jurisdictions SET display_source = ${DISPLAY.url} WHERE id = 'county-w'`;

    const result = await builder.build(REGION, COUNTIES);

    expect(result.incompleteTypes).toEqual([]);
    expect(
      await db.jurisdictionShape.count({
        where: { jurisdictionId: 'county-w' },
      }),
    ).toBe(0);
    expect(
      await db.jurisdictionShape.count({
        where: { jurisdictionId: 'county-a' },
      }),
    ).toBe(2);
  });

  it('is not held back by rows no display layer owns', async () => {
    await seedRegion();
    // A county row with a boundary but no code: no display source can ever
    // match it, so it must not keep the county layer incomplete.
    await db.$executeRaw`
      INSERT INTO jurisdictions (id, name, type, level, state_code, boundary, updated_at)
      VALUES ('county-x', 'county-x', 'COUNTY'::"JurisdictionType", 'COUNTY'::"JurisdictionLevel", 'ZZ',
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${polygon(rect(11, 11.5))}::text), 4326))::geography, now())
    `;

    const result = await builder.build(REGION, COUNTIES);

    expect(result.incompleteTypes).toEqual([]);
    expect(result.frames).toBe(3);
  });

  it('builds nothing without a display projection', async () => {
    await seedRegion();
    const noProjection: BoundarySourcesConfig = {
      ...REGION,
      displayProjection: undefined,
    };

    expect((await builder.build(noProjection, COUNTIES)).skipped).toBe(
      'no-projection',
    );
    expect(await db.shapeFrame.count()).toBe(0);
  });

  describe('reading them back (ShapesQueryService)', () => {
    it('returns nothing before the first build', async () => {
      await seedRegion();

      await expect(
        query.regionShapes([JurisdictionTypeGQL.COUNTY]),
      ).resolves.toBeNull();
      await expect(query.countyShapes('99001')).resolves.toBeNull();
    });

    it('returns only the requested layers, in the shared frame', async () => {
      await seedRegion();
      await builder.build(REGION, COUNTIES);

      const region = await query.regionShapes([JurisdictionTypeGQL.COUNTY]);

      expect(region?.viewBox[2]).toBe(1000);
      expect(region?.shapes.map((s) => s.fipsCode)).toEqual(['99001', '99003']);
      expect(region?.shapes[0]).toMatchObject({
        type: 'COUNTY',
        source: { name: DISPLAY.layerName, url: DISPLAY.url },
      });
      const districts = await query.regionShapes([
        JurisdictionTypeGQL.COUNTY_SUPERVISOR_DISTRICT,
      ]);
      expect(districts?.shapes).toEqual([]);
    });

    it("returns a county's outline, its districts in order, and the fit", async () => {
      await seedRegion();
      await builder.build(REGION, COUNTIES);

      const a = await query.countyShapes('99001');

      expect(a?.outline.jurisdictionId).toBe('county-a');
      expect(a?.districts.map((d) => d.fipsCode)).toEqual([
        'sup-99001-1',
        'sup-99001-2',
      ]);
      expect(a?.fit?.bestEffort).toBe(true);
      expect(a?.districts[0].source.name).toBe('gis.a.example.gov');
    });

    it('gives a county without districts no fit, and an unknown one null', async () => {
      await seedRegion();
      await insert(
        'county-c',
        'COUNTY',
        '99005',
        rect(11, 11.5),
        rect(11, 11.5),
      );
      await builder.build(REGION, COUNTIES);

      const c = await query.countyShapes('99005');
      expect(c?.districts).toEqual([]);
      expect(c?.fit).toBeNull();
      await expect(query.countyShapes('00000')).resolves.toBeNull();
    });
  });
});
