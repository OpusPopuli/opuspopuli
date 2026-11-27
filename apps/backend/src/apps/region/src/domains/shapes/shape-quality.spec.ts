import {
  BEST_EFFORT_TOLERANCE,
  isBestEffort,
  shapeQuality,
} from './shape-quality';

describe('isBestEffort', () => {
  it('is false for a clean plan (0.21% gap, no overlap)', () => {
    expect(isBestEffort(0.0021, 0)).toBe(false);
  });

  it('is true when a plan leaves a real hole', () => {
    expect(isBestEffort(0.02, 0)).toBe(true);
  });

  it('is true when two districts claim the same land', () => {
    expect(isBestEffort(0, 0.01)).toBe(true);
  });

  it('treats the tolerance itself as within it', () => {
    expect(isBestEffort(BEST_EFFORT_TOLERANCE, BEST_EFFORT_TOLERANCE)).toBe(
      false,
    );
  });
});

describe('shapeQuality', () => {
  it('clamps the small negatives area arithmetic produces', () => {
    expect(shapeQuality(-1e-9, -2e-12)).toEqual({
      gapShare: 0,
      overlapShare: 0,
      bestEffort: false,
    });
  });

  it('flags an overlapping plan', () => {
    expect(shapeQuality(0.001, 0.03).bestEffort).toBe(true);
  });
});
