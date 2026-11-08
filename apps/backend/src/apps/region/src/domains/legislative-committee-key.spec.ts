import {
  committeeExternalId,
  committeeKeyCandidates,
} from './legislative-committee-key';

describe('legislative committee keys (bills-phase-b.md D13)', () => {
  it('keeps the linker key as it was, "&" included', () => {
    expect(committeeExternalId('Senate', 'Committee on Appropriations')).toBe(
      'senate:appropriations',
    );
    expect(committeeExternalId('Assembly', 'Growth, & Impact')).toBe(
      'assembly:growth impact',
    );
    expect(committeeExternalId('Senate', 'Committee')).toBeNull();
  });

  it('matches either spelling, and creates under the "and" form', () => {
    expect(
      committeeKeyCandidates(
        'Assembly',
        'Economic Development, Growth, & Household Impact',
      ),
    ).toEqual({
      create: 'assembly:economic development growth and household impact',
      match: [
        'assembly:economic development growth and household impact',
        'assembly:economic development growth household impact',
      ],
    });
    expect(committeeKeyCandidates('Senate', 'Judiciary')).toEqual({
      create: 'senate:judiciary',
      match: ['senate:judiciary'],
    });
  });
});
