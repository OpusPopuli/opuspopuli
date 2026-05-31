import { ExplanationValidatorService } from './explanation-validator.service';

describe('ExplanationValidatorService', () => {
  const validator = new ExplanationValidatorService();

  const FULL_FLAGS = [
    'isRenter',
    'isHomeowner',
    'isParent',
    'isVeteran',
    'hasImmigrationConcern',
    'hasHealthCondition',
    'isLowIncome',
    'hasJusticeInvolvement',
  ];

  it('accepts a clean 15-30 word explanation citing declared signals', () => {
    const result = validator.validate(
      'Caps rent for renters in 94110 — directly affects housing costs you mentioned and the parental costs your household faces too.',
      { userRankingFlags: ['isRenter', 'isParent'] },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects empty explanation', () => {
    expect(
      validator.validate('   ', { userRankingFlags: [] }).rejectionReason,
    ).toBe('empty');
  });

  it('rejects below 15 words', () => {
    expect(
      validator.validate('Affects renters today.', {
        userRankingFlags: ['isRenter'],
      }).rejectionReason,
    ).toBe('word-count');
  });

  it('rejects above 30 words', () => {
    const long = Array.from({ length: 35 }, (_, i) => `word${i}`).join(' ');
    expect(
      validator.validate(long, { userRankingFlags: [] }).rejectionReason,
    ).toBe('word-count');
  });

  it.each([
    'You should vote yes on this bill to ensure protection for renters in your district every year ahead.',
    'We recommend you support this bill because renters in your district would benefit a lot from these protections.',
    'Renters benefit from this bill; oppose this bill if you disagree with the housing-cost protections it provides today.',
  ])('rejects opinion / vote-recommendation language: %s', (text) => {
    expect(
      validator.validate(text, { userRankingFlags: ['isRenter'] })
        .rejectionReason,
    ).toBe('opinion-language');
  });

  it('rejects "veterans" reference when isVeteran is not declared', () => {
    expect(
      validator.validate(
        'Funds veterans tuition costs at California community colleges — supports a meaningful housing-area subsidy you mentioned.',
        { userRankingFlags: ['isRenter'] },
      ).rejectionReason,
    ).toBe('protected-class-leak');
  });

  it('accepts "veterans" reference when isVeteran IS declared', () => {
    const result = validator.validate(
      'Funds veterans tuition costs at California community colleges — supports a meaningful housing-area subsidy you mentioned.',
      { userRankingFlags: ['isVeteran', 'isRenter'] },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects "immigrant" reference when hasImmigrationConcern is not declared', () => {
    expect(
      validator.validate(
        'Expands services for immigrants in California counties — touches housing-related programs you mentioned and community resources too.',
        { userRankingFlags: ['isRenter'] },
      ).rejectionReason,
    ).toBe('protected-class-leak');
  });

  it('rejects "low-income" reference when isLowIncome is not declared', () => {
    expect(
      validator.validate(
        'Expands services for low-income residents in California counties — touches housing-related programs you mentioned and community resources too.',
        { userRankingFlags: ['isRenter'] },
      ).rejectionReason,
    ).toBe('protected-class-leak');
  });

  it('accepts protected-class words when ALL relevant flags are declared (sanity)', () => {
    const result = validator.validate(
      'Expands services for veterans, immigrants, and low-income residents — directly affects housing-area programs you mentioned today.',
      { userRankingFlags: FULL_FLAGS },
    );
    expect(result.valid).toBe(true);
  });
});
