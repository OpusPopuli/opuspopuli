import { extractLastName } from './region.service';
import { trimLeadingName } from './representatives-sync.service';

/**
 * Fixtures are the REAL text, taken 2026-10-20 from the nine
 * `sdNN.senate.ca.gov` pages that yield a bio through the configured
 * `aside .field--name-body` selector, after `trimBioChrome` has applied the
 * region's `bioTrimPatterns`. Names are as the ROSTER gives them, which is
 * what `normalizeRep` passes — note where roster and page disagree.
 */
describe('trimLeadingName', () => {
  describe('strips a leading name heading', () => {
    const CASES = [
      {
        page: 'sd02',
        name: 'Mike McGuire',
        // The page repeats the name: heading, then the prose subject.
        bio: 'Mike McGuire Mike McGuire is pro Tem Emeritus of the California State Senate. He is focused on tackling the issues facing the Golden State.',
        want:
          'Mike McGuire is pro Tem Emeritus of the California State Senate. ' +
          'He is focused on tackling the issues facing the Golden State.',
      },
      {
        page: 'sd07',
        name: 'Jesse Arreguín',
        // Accented surname — the separator class must be letter-aware, not [A-Za-z].
        bio: 'Jesse Arreguín A lifelong advocate for economic and social justice, Senator Jesse Arreguin proudly represents the Seventh Senate District.',
        want:
          'A lifelong advocate for economic and social justice, Senator ' +
          'Jesse Arreguin proudly represents the Seventh Senate District.',
      },
      {
        page: 'sd08',
        // Roster carries a middle initial the page does not.
        name: 'Angelique V. Ashby',
        bio: 'Angelique Ashby Senator Ashby was elected in 2022 to represent Sacramento and Elk Grove.',
        want:
          'Senator Ashby was elected in 2022 to represent Sacramento and ' +
          'Elk Grove.',
      },
      {
        page: 'sd09',
        // Roster "Timothy S.", page "Tim" — why this anchors on the surname.
        name: 'Timothy S. Grayson',
        bio: 'Tim Grayson Elected to represent California’s 9th Senate District in November 2024, Senator Tim Grayson remains a committed public servant.',
        want:
          'Elected to represent California’s 9th Senate District in ' +
          'November 2024, Senator Tim Grayson remains a committed public servant.',
      },
      {
        page: 'sd11',
        name: 'Scott D. Wiener',
        bio: 'Scott Wiener Senator Scott Wiener represents San Francisco and northern San Mateo County in the California State Senate.',
        want:
          'Senator Scott Wiener represents San Francisco and northern San ' +
          'Mateo County in the California State Senate.',
      },
      {
        page: 'sd18',
        // Roster "Stephen C.", page "Steve". Also carries a stray `-->` that
        // leaks out of extraction; the non-letter run consumes it.
        name: 'Stephen C. Padilla',
        bio: 'Steve Padilla --> Senator Steve Padilla was elected in 2022 representing the counties of San Diego, Imperial, Riverside and San Bernardino.',
        want:
          'Senator Steve Padilla was elected in 2022 representing the ' +
          'counties of San Diego, Imperial, Riverside and San Bernardino.',
      },
    ];

    it.each(CASES)('$page ($name)', ({ name, bio, want }) => {
      expect(trimLeadingName(bio, name)).toBe(want);
    });
  });

  describe('leaves prose alone', () => {
    it('keeps a title that IS the prose (sd21)', () => {
      // The page this fix must not touch: the honorific runs straight into
      // the verb, so the name is the sentence's subject, not a heading.
      const bio =
        'Senate President pro Tempore Monique Limón was elected to the ' +
        'Senate in November 2020 and represents the 21st Senate District.';

      expect(trimLeadingName(bio, 'Monique Limón')).toBe(bio);
    });

    it('keeps the opening that killed the previous heuristic', () => {
      // The surname-anchored trim turned this into "was elected in 2022…".
      // A lower-case verb after the surname is what tells prose from chrome.
      const bio =
        'Senator Ashby was elected in 2022 to represent Sacramento and ' +
        'Elk Grove in the California State Senate.';

      expect(trimLeadingName(bio, 'Angelique V. Ashby')).toBe(bio);
    });

    it('keeps a bio that opens with the bare surname as subject', () => {
      const bio =
        'Wiener represents San Francisco in the California State Senate ' +
        'and chairs the Budget committee.';

      expect(trimLeadingName(bio, 'Scott D. Wiener')).toBe(bio);
    });

    it('keeps a bio whose surname never appears', () => {
      const bio =
        'The senator represents San Francisco in the California State ' +
        'Senate and chairs the Budget committee.';

      expect(trimLeadingName(bio, 'Scott D. Wiener')).toBe(bio);
    });

    it('does not reach past the token limit into prose', () => {
      // "Padilla" sits 6 tokens in. Anchoring there would delete the whole
      // opening clause, so the limit must stop the match.
      const bio =
        'A lifelong resident of the South Bay, Padilla Was first elected ' +
        'to the city council.';

      expect(trimLeadingName(bio, 'Stephen C. Padilla')).toBe(bio);
    });
  });

  describe('edge cases', () => {
    it('handles a two-word surname inside the token budget', () => {
      // extractLastName takes the final token, so the anchor is "Reyes" with
      // "Eloise Gómez" ahead of it.
      const bio =
        'Eloise Gómez Reyes Senator Reyes represents the Inland Empire.';

      expect(trimLeadingName(bio, 'Eloise Gómez Reyes')).toBe(
        'Senator Reyes represents the Inland Empire.',
      );
    });

    it('matches a surname containing a regex metacharacter literally', () => {
      const bio = "D'Angelo+Smith Senator Smith represents the district.";

      // Unescaped, `D'Angelo+Smith` means "D'Angel" then one-or-more "o"
      // then "Smith", which does not match the literal text at all — so the
      // heading would survive. Escaped, it matches and is removed.
      expect(trimLeadingName(bio, "Ana D'Angelo+Smith")).toBe(
        'Senator Smith represents the district.',
      );
    });

    it('does not sever a word the surname merely prefixes', () => {
      // Surname "Lee" prefixes "LeeAnn". With a zero-width separator the
      // match ends mid-word and the bio is published as "Ann Smith Is a
      // lifelong…" — a severed first name under a representative's byline.
      const bio = 'LeeAnn Smith Is a lifelong resident of the district.';

      expect(trimLeadingName(bio, 'Alex Lee')).toBe(bio);
    });

    it('keeps an accented capital that opens the next sentence', () => {
      // The separator must be letter-aware: an ASCII-only class consumes the
      // "É", leaving the lookahead to fail and the heading to survive.
      const bio = 'Monique Limón Él representa el distrito 21 del Senado.';

      expect(trimLeadingName(bio, 'Monique Limón')).toBe(
        'Él representa el distrito 21 del Senado.',
      );
    });

    it('leaves the bio alone when the name is empty', () => {
      // With no surname the pattern degenerates to "any run of non-letters
      // before a capital", which would eat a leading date or bullet. A
      // nameless roster row is a broken record, not a trimming opportunity.
      const bio = '2026 Update: Senator Smith represents the district.';

      expect(trimLeadingName(bio, '')).toBe(bio);
    });

    it('does not strip when nothing follows the name', () => {
      // A bio that is ONLY the heading has no sentence to keep; leaving it
      // intact lets the length floor discard it, which is the right outcome.
      expect(trimLeadingName('Jesse Arreguín', 'Jesse Arreguín')).toBe(
        'Jesse Arreguín',
      );
    });
  });
});

describe('extractLastName — credential suffixes (#1381)', () => {
  it.each([
    // Both of these were stored as their credential, observed on the
    // 2026-10-21 full sync: last_name = 'M.D.' and 'Ph.D.'.
    ['Akilah Weber Pierson M.D.', 'Pierson'],
    ['Steven S. Choi Ph.D.', 'Choi'],
    ['José Luis Solache Jr.', 'Solache'],
    ['Jane Doe M.D. Ph.D.', 'Doe'],
    ['Alex Lee', 'Lee'],
    ['Cecilia M. Aguiar-Curry', 'Aguiar-Curry'],
    ['Eloise Gómez Reyes', 'Reyes'],
    ['Smith, John', 'Smith'],
    ['Smith Jr., John', 'Smith'],
    // Bare "MD" is NOT stripped: it collides with real surnames the way
    // "Do" does, so an unpunctuated ambiguous token stays part of the name.
    ['Akilah Weber Pierson MD', 'MD'],
    // Real surnames that collide with credential abbreviations.
    ['Andrew Do', 'Do'],
    ['Nguyen Do', 'Do'],
    ['Mary Rn', 'Rn'],
    ['Henry V', 'V'],
    // Punctuated, so unambiguously a credential.
    ['Jane Doe R.N.', 'Doe'],
    ['Henry Ford V.', 'Ford'],
    ['Akilah Weber Pierson, M.D.', 'Pierson'],
  ])('%s -> %s', (full, want) => {
    expect(extractLastName(full)).toBe(want);
  });

  it('returns the input when every token is a suffix', () => {
    // Bad input. Erasing it to '' would hide that; the lastName column would
    // silently go blank instead of obviously wrong.
    expect(extractLastName('Jr. Sr.')).toBe('Jr. Sr.');
  });

  it('is empty only for an empty name', () => {
    expect(extractLastName('   ')).toBe('');
  });

  it('lets trimLeadingName reach a credentialed name heading', () => {
    // ca-senate-39's real page, which kept "Dr. Akilah Weber Pierson" as a
    // heading because the surname resolved to "M.D." and never matched.
    const bio =
      'Dr. Akilah Weber Pierson Previously representing California’s 79th ' +
      'Assembly District, she now serves the 39th Senate District.';

    expect(trimLeadingName(bio, 'Akilah Weber Pierson M.D.')).toBe(
      'Previously representing California’s 79th Assembly District, she now ' +
        'serves the 39th Senate District.',
    );
  });
});
