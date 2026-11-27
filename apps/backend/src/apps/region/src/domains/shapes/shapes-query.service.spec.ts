/**
 * ShapesQueryService's shaping of stored rows, with the database mocked.
 * The queries run against PostGIS in
 * __tests__/integration/region/shapes-builder.integration.spec.ts.
 */
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { JurisdictionTypeGQL } from '../models/jurisdiction.model';
import { ShapesQueryService } from './shapes-query.service';

const shape = (
  id: string,
  type: string,
  fipsCode: string | null,
  name = id,
) => ({
  frameKey: 'k',
  jurisdictionId: id,
  path: 'M0 0 1 0 1 1Z',
  sourceName: 'src',
  sourceUrl: 'https://example.gov/x',
  retrievedAt: new Date('2026-11-27T00:00:00Z'),
  jurisdiction: { id, name, type, fipsCode },
});

const frame = (
  shapes: unknown[],
  fit: Partial<
    Record<'gapShare' | 'overlapShare' | 'bestEffort', unknown>
  > = {},
) => ({
  frameKey: 'k',
  viewBox: [0, 0, 1000, 800],
  gapShare: null,
  overlapShare: null,
  bestEffort: null,
  shapes,
  ...fit,
});

function serviceWith(opts: {
  frame?: unknown;
  county?: { id: string } | null;
}) {
  const db = {
    shapeFrame: { findUnique: jest.fn().mockResolvedValue(opts.frame ?? null) },
    jurisdiction: {
      findFirst: jest.fn().mockResolvedValue(opts.county ?? null),
    },
  };
  return { service: new ShapesQueryService(db as unknown as DbService), db };
}

describe('ShapesQueryService (#1475)', () => {
  describe('regionShapes', () => {
    it('is null before the first build', async () => {
      const { service } = serviceWith({});
      await expect(
        service.regionShapes([JurisdictionTypeGQL.COUNTY]),
      ).resolves.toBeNull();
    });

    it('filters the frame to the requested types and maps each shape', async () => {
      const { service, db } = serviceWith({
        frame: frame([shape('a', 'COUNTY', '99001', 'A County')]),
      });

      const result = await service.regionShapes([JurisdictionTypeGQL.COUNTY]);

      expect(
        db.shapeFrame.findUnique.mock.calls[0][0].include.shapes.where,
      ).toEqual({
        jurisdiction: { type: { in: ['COUNTY'] } },
      });
      expect(result).toEqual({
        viewBox: [0, 0, 1000, 800],
        shapes: [
          {
            jurisdictionId: 'a',
            fipsCode: '99001',
            name: 'A County',
            type: 'COUNTY',
            path: 'M0 0 1 0 1 1Z',
            source: {
              name: 'src',
              url: 'https://example.gov/x',
              retrievedAt: new Date('2026-11-27T00:00:00Z'),
            },
          },
        ],
      });
    });
  });

  describe('countyShapes', () => {
    it('is null for an unknown county', async () => {
      const { service, db } = serviceWith({ county: null });
      await expect(service.countyShapes('99999')).resolves.toBeNull();
      expect(db.shapeFrame.findUnique).not.toHaveBeenCalled();
    });

    it('is null when the county has no frame, or its frame no outline', async () => {
      expect(
        await serviceWith({ county: { id: 'a' } }).service.countyShapes(
          '99001',
        ),
      ).toBeNull();
      const noOutline = serviceWith({
        county: { id: 'a' },
        frame: frame([shape('d1', 'COUNTY_SUPERVISOR_DISTRICT', 'sup-1')]),
      });
      expect(await noOutline.service.countyShapes('99001')).toBeNull();
    });

    it('separates the outline, sorts districts by number, and reports the fit', async () => {
      const { service } = serviceWith({
        county: { id: 'a' },
        frame: frame(
          [
            shape('d10', 'COUNTY_SUPERVISOR_DISTRICT', 'sup-99001-10'),
            shape('a', 'COUNTY', '99001'),
            shape('d2', 'COUNTY_SUPERVISOR_DISTRICT', 'sup-99001-2'),
            shape('dx', 'COUNTY_SUPERVISOR_DISTRICT', null, 'Unnumbered'),
          ],
          { gapShare: 0.01, overlapShare: 0, bestEffort: true },
        ),
      });

      const result = await service.countyShapes('99001');

      expect(result?.outline.jurisdictionId).toBe('a');
      expect(result?.districts.map((d) => d.fipsCode ?? d.name)).toEqual([
        'sup-99001-2',
        'sup-99001-10',
        'Unnumbered',
      ]);
      expect(result?.fit).toEqual({
        gapShare: 0.01,
        overlapShare: 0,
        bestEffort: true,
      });
    });

    it('gives a county without measured districts no fit', async () => {
      const { service } = serviceWith({
        county: { id: 'a' },
        frame: frame([shape('a', 'COUNTY', '99001')]),
      });

      const result = await service.countyShapes('99001');

      expect(result?.districts).toEqual([]);
      expect(result?.fit).toBeNull();
    });
  });
});
