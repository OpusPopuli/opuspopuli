import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { JurisdictionTypeGQL } from '../models/jurisdiction.model';
import { CountyShapesArgs, RegionShapesArgs } from './shapes.args';

const errors = <T extends object>(cls: new () => T, value: object) =>
  validateSync(plainToInstance(cls, value));

describe('shapes args (#1475)', () => {
  it.each([['06097'], ['sup-1'], ['A1']])(
    'accepts the county code %p',
    (fips) => {
      expect(errors(CountyShapesArgs, { fips })).toHaveLength(0);
    },
  );

  it.each([[''], ['x'.repeat(21)], ["06097' OR 1=1"], ['../x']])(
    'rejects the county code %p',
    (fips) => {
      expect(errors(CountyShapesArgs, { fips }).length).toBeGreaterThan(0);
    },
  );

  it('accepts one or more known layer types', () => {
    expect(
      errors(RegionShapesArgs, {
        types: [
          JurisdictionTypeGQL.COUNTY,
          JurisdictionTypeGQL.STATE_SENATE_DISTRICT,
        ],
      }),
    ).toHaveLength(0);
  });

  it.each([
    [[]],
    [['NOT_A_TYPE']],
    [Array(9).fill(JurisdictionTypeGQL.COUNTY)],
  ])('rejects the layer types %p', (types) => {
    expect(errors(RegionShapesArgs, { types }).length).toBeGreaterThan(0);
  });
});
