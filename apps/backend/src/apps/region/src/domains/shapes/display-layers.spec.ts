import type {
  BoundarySourcesConfig,
  TigerLayerConfig,
} from '@opuspopuli/region-provider';
import { ambiguousDisplayLayers } from './display-layers';

const layer = (
  type: TigerLayerConfig['jurisdictionType'],
  fipsPrefix: string | undefined,
  name: string,
  display = true,
): TigerLayerConfig => ({
  layer: 'X/MapServer',
  outFields: 'GEOID',
  jurisdictionType: type,
  level: 'STATE',
  nameField: 'NAME',
  fipsPrefix,
  ...(display && {
    display: { url: 'https://example.gov/MapServer', layerName: name },
  }),
});
const group = (...tigerLayers: TigerLayerConfig[]): BoundarySourcesConfig => ({
  ocdIdPrefix: 'ocd-division/country:zz',
  tigerLayers,
});

describe('ambiguousDisplayLayers (#1475)', () => {
  it('accepts one display layer per type, and distinct prefixes within a type', () => {
    const result = ambiguousDisplayLayers([
      group(
        layer('COUNTY', undefined, 'Counties'),
        layer('STATE_SENATE_DISTRICT', 'sldu-', 'Senate'),
      ),
      group(
        layer('SCHOOL_DISTRICT_UNIFIED', 'east-', 'East'),
        layer('SCHOOL_DISTRICT_UNIFIED', 'west-', 'West'),
      ),
    ]);

    expect(result.layers.size).toBe(0);
    expect(result.clashes).toEqual([]);
  });

  it('flags an unprefixed layer sharing a type with a prefixed one, across groups', () => {
    const statewide = layer('COUNTY', undefined, 'Counties');
    const county = layer('COUNTY', 'east-', 'East counties');

    const result = ambiguousDisplayLayers([group(statewide), group(county)]);

    expect([...result.layers]).toEqual([statewide, county]);
    expect(result.clashes[0]).toMatch(
      /'Counties' \(prefix ''\) and 'East counties' \(prefix 'east-'\)/,
    );
  });

  it('flags equal prefixes, and one prefix nested in another', () => {
    expect(
      ambiguousDisplayLayers([
        group(layer('COUNTY', 'a-', 'One'), layer('COUNTY', 'a-', 'Two')),
      ]).layers.size,
    ).toBe(2);
    expect(
      ambiguousDisplayLayers([
        group(layer('COUNTY', 'a-', 'One'), layer('COUNTY', 'a-b-', 'Two')),
      ]).layers.size,
    ).toBe(2);
  });

  it('ignores layers without a display source', () => {
    const result = ambiguousDisplayLayers([
      group(
        layer('COUNTY', undefined, 'Counties'),
        layer('COUNTY', 'x-', 'Plain', false),
      ),
    ]);

    expect(result.layers.size).toBe(0);
  });
});
