import type { FeatureCollection, Polygon, Position } from 'geojson';
import {
  bboxOf,
  fitBbox,
  geometryToPath,
  minAreaFor,
  ringToPath,
  simplifyTogether,
} from './shape-geometry';

const identity = ([x, y]: Position): [number, number] => [x, y];

describe('fitBbox', () => {
  it('fits the width, keeps the aspect, and puts north at the top', () => {
    const fit = fitBbox([0, 0, 2000, 1000], 1000, 0);
    expect(fit.viewBox).toEqual([0, 0, 1000, 500]);
    expect(fit.unit).toBe(2);
    expect(fit.project([0, 1000])).toEqual([0, 0]); // north-west corner
    expect(fit.project([2000, 0])).toEqual([1000, 500]); // south-east corner
  });

  it('rounds to whole units inside the padding', () => {
    const fit = fitBbox([0, 0, 992, 992], 1000, 4);
    expect(fit.project([0.4, 991.6])).toEqual([4, 4]);
  });

  it('refuses an empty bbox', () => {
    expect(() => fitBbox([5, 5, 5, 9])).toThrow(/empty bbox/);
    expect(() => fitBbox(bboxOf([]))).toThrow(/empty bbox/);
  });
});

describe('bboxOf', () => {
  it('spans polygons and multipolygons', () => {
    expect(
      bboxOf([
        {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [3, 2],
              [3, 5],
              [1, 2],
            ],
          ],
        },
        {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-4, 0],
                [0, 9],
                [0, 0],
                [-4, 0],
              ],
            ],
          ],
        },
      ]),
    ).toEqual([-4, 0, 3, 9]);
  });
});

describe('bboxOf, other geometry types', () => {
  it('spans a geometry collection and ignores geometry without area', () => {
    expect(
      bboxOf([
        {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [2, 0],
                  [2, 2],
                  [0, 0],
                ],
              ],
            },
            { type: 'Point', coordinates: [50, 50] },
          ],
        },
      ]),
    ).toEqual([0, 0, 2, 2]);
  });
});

describe('ringToPath', () => {
  it('writes M with implicit line-tos and closes with Z, without repeating the first point', () => {
    expect(
      ringToPath(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
        identity,
      ),
    ).toBe('M0 0 10 0 10 10Z');
  });

  it('drops points that land on their neighbour', () => {
    const half = ([x, y]: Position): [number, number] => [
      Math.round(x / 2),
      Math.round(y / 2),
    ];
    expect(
      ringToPath(
        [
          [0, 0],
          [0.8, 0],
          [20, 0],
          [20, 20],
          [0, 0],
        ],
        half,
      ),
    ).toBe('M0 0 10 0 10 10Z');
  });

  it('skips a ring too small to draw', () => {
    expect(
      ringToPath(
        [
          [0, 0],
          [0.1, 0],
          [0, 0.1],
          [0, 0],
        ],
        ([x, y]) => [Math.round(x), Math.round(y)],
      ),
    ).toBeNull();
    expect(ringToPath([], identity)).toBeNull();
  });
});

describe('geometryToPath', () => {
  it('joins every ring of every polygon, holes included', () => {
    const d = geometryToPath(
      {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [9, 0],
              [9, 9],
              [0, 0],
            ],
            [
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 1],
            ],
          ],
          [
            [
              [20, 20],
              [29, 20],
              [29, 29],
              [20, 20],
            ],
          ],
        ],
      },
      identity,
    );
    expect(d).toBe('M0 0 9 0 9 9ZM1 1 2 1 2 2ZM20 20 29 20 29 29Z');
  });

  it('draws nothing for no geometry or a non-area one', () => {
    expect(geometryToPath(null, identity)).toBe('');
    expect(
      geometryToPath({ type: 'Point', coordinates: [0, 0] }, identity),
    ).toBe('');
  });
});

describe('minAreaFor', () => {
  it('keeps a vertex only if it moves the line by at least the tolerance', () => {
    expect(minAreaFor(1000)).toBe(250_000);
    expect(minAreaFor(100, 1)).toBe(10_000);
  });
});

describe('simplifyTogether', () => {
  // Two squares meeting along a zig-zag border at x ≈ 1000.
  const zigzag: Position[] = Array.from({ length: 101 }, (_, i) => [
    1000 + (i % 2 === 0 ? 0 : 3),
    i * 10,
  ]);
  const west: Polygon = {
    type: 'Polygon',
    coordinates: [[[0, 0], ...zigzag, [0, 1000], [0, 0]]],
  };
  const east: Polygon = {
    type: 'Polygon',
    coordinates: [
      [[2000, 0], [2000, 1000], ...[...zigzag].reverse(), [2000, 0]],
    ],
  };
  const layer: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'w', properties: {}, geometry: west },
      { type: 'Feature', id: 'e', properties: {}, geometry: east },
    ],
  };

  const borderPoints = (coords: Position[]) =>
    coords
      .filter(([x]) => x > 500 && x < 1500)
      .map((p) => p.join(','))
      .sort();

  it('simplifies a shared border once, so neighbours keep the same line', () => {
    const { counties } = simplifyTogether({ counties: layer }, 100);
    const [w, e] = counties.map((f) => (f.geometry as Polygon).coordinates[0]);
    expect(borderPoints(w).length).toBeLessThan(zigzag.length);
    expect(new Set(borderPoints(w))).toEqual(new Set(borderPoints(e)));
  });

  it('returns every layer it was given', () => {
    const out = simplifyTogether(
      { a: layer, b: { type: 'FeatureCollection', features: [] } },
      1,
    );
    expect(out.a).toHaveLength(2);
    expect(out.b).toHaveLength(0);
  });
});
