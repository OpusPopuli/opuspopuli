/**
 * Texts for the #1074 retrieval negative control.
 *
 * Shared by the spec and by `generate-petition-retrieval-vectors.ts`, so the
 * committed vectors and the asserted texts cannot drift apart silently — the
 * fixture records a hash of each string and the spec refuses to run against a
 * stale one.
 */

/**
 * Corpus stand-ins in the shape the real one has: an Attorney General
 * circulating title in caps plus its official summary.
 * `PropositionEmbeddingService.embeddingSource` embeds exactly
 * `title\n\nsummary`, and `embeddingSourceFor` below reproduces that, so
 * retrieval sees the vectors it would see in production.
 */
export const CORPUS = [
  {
    externalId: 'TEST-NC-0001',
    title:
      'REQUIRES VOTERS TO PRESENT PHOTOGRAPHIC IDENTIFICATION. INITIATIVE CONSTITUTIONAL AMENDMENT.',
    summary:
      'Requires every voter to present government-issued photographic identification before ' +
      'casting a ballot in person. Requires county elections officials to verify identification ' +
      'against the statewide voter registration database. Provides a free identification card to ' +
      'eligible voters who declare an inability to pay. Applies to all state and local elections.',
  },
  {
    externalId: 'TEST-NC-0002',
    title: 'LIMITS ANNUAL INCREASES IN RESIDENTIAL RENT. INITIATIVE STATUTE.',
    summary:
      'Limits annual rent increases for residential tenancies to five percent plus the change in ' +
      'the regional consumer price index. Exempts housing first occupied within the previous ' +
      'fifteen years. Authorizes local governments to adopt stricter limits. Provides for ' +
      'enforcement by the Department of Housing and Community Development.',
  },
  {
    externalId: 'TEST-NC-0003',
    title:
      'AUTHORIZES BONDS FOR WATER STORAGE AND CONVEYANCE INFRASTRUCTURE. INITIATIVE STATUTE.',
    summary:
      'Authorizes the issuance of eight billion dollars in general obligation bonds to finance ' +
      'water storage, groundwater recharge, and conveyance projects. Requires independent audits ' +
      'and annual reporting to the Legislature. Prohibits the use of bond proceeds for ' +
      'administrative overhead exceeding five percent.',
  },
  {
    externalId: 'TEST-NC-0004',
    title:
      'INCREASES FUNDING FOR PUBLIC SCHOOLS AND COMMUNITY COLLEGES. INITIATIVE STATUTE.',
    summary:
      'Increases the minimum funding guarantee for public schools and community colleges. ' +
      'Dedicates revenue to teacher salaries, classroom materials, and school facility repair. ' +
      'Requires each district to publish an annual accounting of expenditures by school site.',
  },
] as const;

/** Mirrors `PropositionEmbeddingService.embeddingSource`. */
export function embeddingSourceFor(measure: {
  title: string;
  summary: string;
}): string {
  return [measure.title, measure.summary].join('\n\n').trim();
}

/**
 * The positive control: an OCR-shaped reading of TEST-NC-0001 as it comes off
 * a photographed clipboard — circulating title recovered, summary partially
 * recovered, some OCR damage, and the signature-block furniture that survives
 * every real scan. Deliberately not a copy of the seeded string, which would
 * test string equality by another route.
 */
export const SCAN_OF_A_FILED_MEASURE =
  'REQUIRES VOTERS TO PRESENT PHOTOGRAPHIC IDENTlFICATION. INITIATIVE CONSTITUTIONAL AMENDMENT. ' +
  'Requires every voter to present government-issued photographic identif1cation before casting ' +
  'a ballot in person. Requires county elections officials to verify identification against the ' +
  'statewide voter registration database. Provides a free identification card to eligible voters. ' +
  'SIGN HERE  PRINT YOUR NAME AS IT APPEARS ON YOUR VOTER REGISTRATION  RESIDENCE ADDRESS';

/**
 * The negative control: a well-formed initiative in exactly the register of
 * the corpus — same legalese, same structure, plausibly real — that was never
 * filed and is not in the corpus. This is the case the `unverified` label
 * exists for, and it is the hard case: every measure in the corpus is written
 * in near-identical language, so nothing about the wording marks this one as
 * absent.
 */
export const SCAN_OF_AN_UNFILED_MEASURE =
  'REQUIRES MUNICIPAL STREETLIGHT MAINTENANCE AND REPLACEMENT. INITIATIVE ORDINANCE. ' +
  'Requires the city to inspect every streetlight within its jurisdiction annually and to repair ' +
  'or replace any fixture found inoperable within thirty days of inspection. Establishes a ' +
  'dedicated maintenance fund supported by existing utility franchise revenue. Requires the ' +
  'public works department to publish quarterly reports of outages by council district. ' +
  'SIGN HERE  PRINT YOUR NAME AS IT APPEARS ON YOUR VOTER REGISTRATION  RESIDENCE ADDRESS';

/** Every string the fixture must carry a vector for, keyed stably. */
export function fixtureTexts(): Record<string, string> {
  const entries: Record<string, string> = {
    'scan:filed': SCAN_OF_A_FILED_MEASURE,
    'scan:unfiled': SCAN_OF_AN_UNFILED_MEASURE,
  };
  for (const measure of CORPUS) {
    entries[`corpus:${measure.externalId}`] = embeddingSourceFor(measure);
  }
  return entries;
}
