import {
  scrubSignatureBlock,
  SIGNATURE_BLOCK_MARKERS,
} from './signature-scrub';

/**
 * The second layer that keeps other voters' details out of `extractedText`
 * (#1075). The first is the client-side crop; this covers what the crop
 * cannot.
 *
 * Text taken from the Secretary of State's sample petition and from a real
 * circulating petition, 25-0007A1.
 */

const MEASURE_TEXT = [
  'INITIATIVE MEASURE TO BE SUBMITTED DIRECTLY TO THE VOTERS',
  'The Attorney General of California has prepared the following circulating',
  'title and summary of the chief purpose and points of the proposed measure:',
  '(25-0007A1) ESTABLISHES ADDITIONAL VOTER IDENTIFICATION AND CITIZENSHIP',
  'VERIFICATION REQUIREMENTS. INITIATIVE CONSTITUTIONAL AMENDMENT.',
  'SECTION 1. FINDINGS AND PURPOSES.',
].join('\n');

const SIGNATURE_BLOCK = [
  'REGISTERED VOTERS ONLY',
  '1. Print Your Name: Jane Q Public',
  'Residence Address ONLY: 42 Elm Street',
  'Sign As Registered To Vote: Jane Q Public',
  'City: Oakland   Zip: 94601',
  '2. Print Your Name: John Doe',
  'Residence Address ONLY: 9 Oak Avenue',
  'City: Berkeley   Zip: 94704',
  'DECLARATION OF CIRCULATOR',
  'I, Alex Roe, am 18 years of age or older. My residence address is',
  '77 Pine Road, Oakland, CA 94611',
].join('\n');

describe('scrubSignatureBlock', () => {
  it('keeps the measure and drops the signature block', () => {
    const { text, scrubbed } = scrubSignatureBlock(
      `${MEASURE_TEXT}\n${SIGNATURE_BLOCK}`,
    );

    expect(scrubbed).toBe(true);
    expect(text).toContain('ESTABLISHES ADDITIONAL VOTER IDENTIFICATION');
    expect(text).toContain('SECTION 1. FINDINGS AND PURPOSES.');
  });

  it.each([
    ['a signer name', 'Jane Q Public'],
    ['another signer name', 'John Doe'],
    ['a signer address', '42 Elm Street'],
    ['a signer city', 'Berkeley'],
    ['a circulator name', 'Alex Roe'],
    ['a circulator address', '77 Pine Road'],
  ])('removes %s', (_label, needle) => {
    const { text } = scrubSignatureBlock(`${MEASURE_TEXT}\n${SIGNATURE_BLOCK}`);
    expect(text).not.toContain(needle);
  });

  it('leaves text alone when no block is present', () => {
    const { text, scrubbed } = scrubSignatureBlock(MEASURE_TEXT);

    expect(scrubbed).toBe(false);
    expect(text).toBe(MEASURE_TEXT);
  });

  /**
   * The reason weak labels are excluded from the marker list. A measure may
   * legitimately use these words — this one is about residency requirements —
   * and matching them would discard the measure instead of the signatures.
   */
  it('does not truncate a measure that uses the words city, zip or residence address', () => {
    const measure = [
      'SECTION 2. Each voter shall provide a residence address at registration.',
      'The city and zip code of that residence address shall be recorded.',
      'Residence address changes must be reported within 30 days.',
    ].join('\n');

    const { text, scrubbed } = scrubSignatureBlock(measure);

    expect(scrubbed).toBe(false);
    expect(text).toBe(measure);
  });

  it('cuts at the FIRST marker, not the last', () => {
    // The block repeats its labels per row; cutting at the last occurrence
    // would keep nearly the whole block.
    const { text } = scrubSignatureBlock(`${MEASURE_TEXT}\n${SIGNATURE_BLOCK}`);
    expect(text).not.toContain('Print Your Name');
    expect(text).not.toContain('DECLARATION OF CIRCULATOR');
  });

  it('is case-insensitive', () => {
    const { scrubbed, text } = scrubSignatureBlock(
      `${MEASURE_TEXT}\nprint your name: someone`,
    );
    expect(scrubbed).toBe(true);
    expect(text).not.toContain('someone');
  });

  it.each(SIGNATURE_BLOCK_MARKERS)('detects the marker %s', (marker) => {
    const { scrubbed } = scrubSignatureBlock(`Measure text.\n${marker} here`);
    expect(scrubbed).toBe(true);
  });

  /**
   * A rotated capture can read the block first. Returning empty is correct:
   * the minimum-text pre-gate then records `unreadable` rather than analysing
   * a page we could not read the measure from.
   */
  it('returns empty when the block starts the text', () => {
    const { text, scrubbed } = scrubSignatureBlock(SIGNATURE_BLOCK);

    expect(scrubbed).toBe(true);
    expect(text).toBe('');
  });

  it('handles empty input without throwing', () => {
    expect(scrubSignatureBlock('')).toEqual({ text: '', scrubbed: false });
  });
});
