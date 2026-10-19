import {
  RegionDomainService,
  extractLastName,
  isLikelyValidBio,
  mapPropositionRecord,
  stripLeadingZerosFromExternalId,
} from './region.service';

// ─── extractLastName ──────────────────────────────────────────────────────────

describe('extractLastName', () => {
  it('extracts last word from "First Last"', () => {
    expect(extractLastName('Juan Alanis')).toBe('Alanis');
  });

  it('extracts last word from "First Middle Last"', () => {
    expect(extractLastName('Cecilia M. Aguiar-Curry')).toBe('Aguiar-Curry');
  });

  it('strips Jr/Sr/III suffixes', () => {
    expect(extractLastName('Patrick J. Ahrens Jr.')).toBe('Ahrens');
    expect(extractLastName('John Doe Sr')).toBe('Doe');
    expect(extractLastName('Frank Smith III')).toBe('Smith');
  });

  it('takes the part before the comma when input is "Last, First"', () => {
    expect(extractLastName('Hadwick, Heather')).toBe('Hadwick');
    expect(extractLastName('Aguiar-Curry, Cecilia M.')).toBe('Aguiar-Curry');
    expect(extractLastName('Tangipa, David J.')).toBe('Tangipa');
    expect(extractLastName('Smith, John Jr.')).toBe('Smith');
  });

  it('handles whitespace around the comma', () => {
    expect(extractLastName('Hadwick ,  Heather')).toBe('Hadwick');
  });

  it('strips suffixes that precede the comma in "Last Suffix, First"', () => {
    expect(extractLastName('Solache Jr., José Luis')).toBe('Solache');
    expect(extractLastName('Smith Sr., John')).toBe('Smith');
    expect(extractLastName('Doe III, Jane')).toBe('Doe');
  });

  it('preserves multi-word surnames before the comma', () => {
    // Spanish double surnames are common — "Ávila Farías" is one
    // surname, not surname + suffix. Suffix stripping only touches
    // the recognized Jr/Sr/II/III/IV/Esq tokens.
    expect(extractLastName('Ávila Farías, Anamarie')).toBe('Ávila Farías');
  });

  it('falls back to trimmed input when no spaces', () => {
    expect(extractLastName('Madonna')).toBe('Madonna');
  });

  it('returns empty for empty input', () => {
    expect(extractLastName('')).toBe('');
    expect(extractLastName('   ')).toBe('');
  });
});

// ─── isLikelyValidBio ─────────────────────────────────────────────────────────

describe('isLikelyValidBio', () => {
  it('rejects empty / null / undefined', () => {
    expect(isLikelyValidBio(null)).toBe(false);
    expect(isLikelyValidBio(undefined)).toBe(false);
    expect(isLikelyValidBio('')).toBe(false);
    expect(isLikelyValidBio('   ')).toBe(false);
  });

  it('rejects bios under 100 chars', () => {
    expect(isLikelyValidBio('Home')).toBe(false);
    expect(isLikelyValidBio('Senator Smith represents District 4.')).toBe(
      false,
    );
  });

  it('rejects "Home" nav-link junk', () => {
    expect(
      isLikelyValidBio(
        'Home page content with a lot of filler text padded out to over a hundred characters total length here',
      ),
    ).toBe(false);
  });

  it('rejects "Latest News" headline blocks', () => {
    expect(
      isLikelyValidBio(
        'Latest News Senator Smith Takes on New Leadership Role with Senate Rules Committee When Is It Enough?',
      ),
    ).toBe(false);
  });

  it('rejects bios where "Latest News" appears after a short biographical-looking header', () => {
    // Real case from CA Senate sync: a per-senator page emits
    // "Senator X Representing District N Latest News [headlines]..."
    // The leading clause looks bio-like but the rest is news content.
    expect(
      isLikelyValidBio(
        'Senator Kelly Seyarto Representing District 32 Latest News Senator Seyarto Proclaims Crime Victims Rights Week California Senate Republicans Introduce Legislation',
      ),
    ).toBe(false);
  });

  it('accepts a real bio with biographical content', () => {
    expect(
      isLikelyValidBio(
        'Senator Smith was elected to represent California Senate District 4 in 2022. Prior to her election she served as a county supervisor for eight years and worked as a public-interest attorney focused on consumer protection.',
      ),
    ).toBe(true);
  });

  it('rejects bios matching custom plugin noise patterns', () => {
    const patterns = [/^About Us/i, /Navigation Menu/i];
    const longJunk =
      'Navigation Menu Contact Us Events Calendar Links Resources Committees ' +
      'Meeting Schedule Agendas Minutes Reports Forms Documents Publications'.repeat(
        2,
      );
    expect(isLikelyValidBio(longJunk, patterns)).toBe(false);
  });

  it('accepts a valid bio when custom patterns are provided and do not match', () => {
    const patterns = [/^About Us/i];
    const realBio =
      'Representative Jane Doe was elected to the State Assembly in 2020. ' +
      'She serves on the Agriculture and Finance committees and has championed ' +
      'water conservation legislation throughout her tenure in the legislature.';
    expect(isLikelyValidBio(realBio, patterns)).toBe(true);
  });
});

// ─── stripLeadingZerosFromExternalId ─────────────────────────────────────────

describe('stripLeadingZerosFromExternalId', () => {
  it('strips leading zeros from a single-digit zero-padded suffix', () => {
    expect(stripLeadingZerosFromExternalId('ca-assembly-01')).toBe(
      'ca-assembly-1',
    );
    expect(stripLeadingZerosFromExternalId('ca-assembly-09')).toBe(
      'ca-assembly-9',
    );
    expect(stripLeadingZerosFromExternalId('ca-senate-01')).toBe('ca-senate-1');
  });

  it('strips multiple leading zeros (e.g. "001")', () => {
    expect(stripLeadingZerosFromExternalId('rep-assembly-001')).toBe(
      'rep-assembly-1',
    );
  });

  it('returns IDs without leading zeros unchanged', () => {
    expect(stripLeadingZerosFromExternalId('ca-assembly-30')).toBe(
      'ca-assembly-30',
    );
    expect(stripLeadingZerosFromExternalId('ca-assembly-80')).toBe(
      'ca-assembly-80',
    );
    expect(stripLeadingZerosFromExternalId('ca-senate-40')).toBe(
      'ca-senate-40',
    );
  });

  it('does not collapse non-padded numeric suffixes (e.g. "100" stays "100")', () => {
    // Important: "ca-assembly-100" is the prefix-one bug from #645 — it's
    // wrong-but-not-zero-padded, so it must NOT be silently rewritten to
    // "ca-assembly-100". (SQL cleanup soft-deletes it instead.)
    expect(stripLeadingZerosFromExternalId('ca-assembly-100')).toBe(
      'ca-assembly-100',
    );
  });

  it('returns IDs whose final segment is not all-digits unchanged', () => {
    expect(stripLeadingZerosFromExternalId('ca-assembly-foo')).toBe(
      'ca-assembly-foo',
    );
    expect(stripLeadingZerosFromExternalId('us-house-AL01')).toBe(
      'us-house-AL01',
    );
  });

  it('returns the input unchanged when there is no hyphen', () => {
    expect(stripLeadingZerosFromExternalId('singleword')).toBe('singleword');
    expect(stripLeadingZerosFromExternalId('123')).toBe('123');
  });

  it('handles "0" as the suffix without stripping it to empty', () => {
    expect(stripLeadingZerosFromExternalId('ca-assembly-0')).toBe(
      'ca-assembly-0',
    );
  });
});

// ─── mapPropositionRecord ─────────────────────────────────────────────────────

describe('mapPropositionRecord', () => {
  // Build a Prisma-shaped proposition row with all 11 analysis columns.
  // mapPropositionRecord must coerce SQL nulls to GraphQL undefined and
  // unpack the JSONB columns that Prisma surfaces as `unknown`.
  function row(
    overrides: Partial<Parameters<typeof mapPropositionRecord>[0]> = {},
  ) {
    const now = new Date('2026-04-25T00:00:00Z');
    return {
      id: 'prop-1',
      externalId: 'SCA 1',
      title: 'Test',
      summary: 'A measure.',
      fullText: null,
      status: 'pending',
      electionDate: null,
      sourceUrl: null,
      analysisSummary: null,
      keyProvisions: null,
      fiscalImpact: null,
      yesOutcome: null,
      noOutcome: null,
      existingVsProposed: null,
      analysisSections: null,
      analysisClaims: null,
      analysisSource: null,
      analysisPromptHash: null,
      analysisGeneratedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as Parameters<typeof mapPropositionRecord>[0];
  }

  it('converts every db null to GraphQL undefined', () => {
    const out = mapPropositionRecord(row());
    expect(out.fullText).toBeUndefined();
    expect(out.electionDate).toBeUndefined();
    expect(out.sourceUrl).toBeUndefined();
    expect(out.analysisSummary).toBeUndefined();
    expect(out.keyProvisions).toBeUndefined();
    expect(out.fiscalImpact).toBeUndefined();
    expect(out.yesOutcome).toBeUndefined();
    expect(out.noOutcome).toBeUndefined();
    expect(out.existingVsProposed).toBeUndefined();
    expect(out.analysisSections).toBeUndefined();
    expect(out.analysisClaims).toBeUndefined();
    expect(out.analysisSource).toBeUndefined();
    expect(out.analysisGeneratedAt).toBeUndefined();
  });

  it('unpacks JSONB array columns when populated', () => {
    const out = mapPropositionRecord(
      row({
        keyProvisions: ['Provision A', 'Provision B'],
        analysisSections: [
          { heading: 'Findings', startOffset: 0, endOffset: 50 },
        ],
        analysisClaims: [
          {
            claim: 'X',
            field: 'keyProvisions',
            sourceStart: 0,
            sourceEnd: 5,
            confidence: 'high',
          },
        ],
      }),
    );
    expect(out.keyProvisions).toEqual(['Provision A', 'Provision B']);
    expect(out.analysisSections).toHaveLength(1);
    expect(out.analysisClaims).toHaveLength(1);
  });

  it('emits existingVsProposed only when the JSONB blob has the expected shape', () => {
    const ok = mapPropositionRecord(
      row({
        existingVsProposed: { current: 'Today', proposed: 'Tomorrow' },
      }),
    );
    expect(ok.existingVsProposed).toEqual({
      current: 'Today',
      proposed: 'Tomorrow',
    });

    const malformed = mapPropositionRecord(
      row({ existingVsProposed: { only: 'wrong shape' } }),
    );
    expect(malformed.existingVsProposed).toBeUndefined();
  });

  it('drops jsonb columns that arrive in unexpected shapes', () => {
    const out = mapPropositionRecord(
      row({
        // Not arrays — defensive code should drop these.
        keyProvisions: { not: 'array' },
        analysisSections: 'not array either',
        analysisClaims: 42,
      }),
    );
    expect(out.keyProvisions).toBeUndefined();
    expect(out.analysisSections).toBeUndefined();
    expect(out.analysisClaims).toBeUndefined();
  });
});

// ─── post-sync standalone triggers (#1000) ────────────────────────────────────

describe('RegionService post-sync triggers', () => {
  const summary = {
    reconciled: 173_804,
    overItemizedContributions: 515,
    overItemizedExpenditures: 4_505,
    withUnitemized: 12,
    unitemizedTotal: 3_400.5,
    unknownSchedule: 0,
    versionMismatch: 91,
  };

  const supersession = {
    contributions: { superseded: 2_832_297, filingsAffected: 10_928 },
    expenditures: { superseded: 1_107_527, filingsAffected: 15_764 },
  };

  const build = (
    overrides: {
      supersessionAvailable?: boolean;
      reconciliationAvailable?: boolean;
    } = {},
  ) => {
    const calls: string[] = [];

    const amendmentSupersession = {
      available: overrides.supersessionAvailable ?? true,
      supersedeAll: jest.fn(async () => {
        calls.push('supersede');
        return supersession;
      }),
    };

    const filingReconciliation = {
      available: overrides.reconciliationAvailable ?? true,
      reconcileAll: jest.fn(async () => {
        calls.push('reconcile');
        return summary;
      }),
    };

    const service = new RegionDomainService(
      {} as never,
      {} as never,
      {} as never,
      amendmentSupersession as never,
      filingReconciliation as never,
    );

    return { service, amendmentSupersession, filingReconciliation, calls };
  };

  describe('reconcileFilings', () => {
    it('returns the recomputed summary, versionMismatch included', async () => {
      const { service, filingReconciliation } = build();

      await expect(service.reconcileFilings()).resolves.toEqual(summary);
      expect(filingReconciliation.reconcileAll).toHaveBeenCalledTimes(1);
    });

    // The guard, not the happy path: `reconcileAll()` returns a ZEROED summary
    // when no db is bound, and `reconciled: 0` from an unbound service is
    // indistinguishable from `reconciled: 0` on a clean corpus. Restoring that
    // zero-return in place of the throw must fail here.
    it('throws rather than reporting a zeroed summary when unavailable', async () => {
      const { service, filingReconciliation } = build({
        reconciliationAvailable: false,
      });

      await expect(service.reconcileFilings()).rejects.toThrow(
        /no database is bound/i,
      );
      expect(filingReconciliation.reconcileAll).not.toHaveBeenCalled();
    });
  });

  describe('supersedeAmendments', () => {
    it('returns both halves', async () => {
      const { service } = build();

      await expect(service.supersedeAmendments()).resolves.toEqual({
        supersession,
        reconciliation: summary,
      });
    });

    // The reason this mutation exists in this shape. Supersession invalidates
    // every stored verdict, so dropping the chained reconciliation reproduces
    // #1000's measured 14x overstatement. Deleting the `reconcileFilings()`
    // call must fail here.
    it('reconciles AFTER superseding, in that order', async () => {
      const { service, calls } = build();

      await service.supersedeAmendments();

      expect(calls).toEqual(['supersede', 'reconcile']);
    });

    it('throws rather than reporting zero superseded rows when unavailable', async () => {
      const { service, amendmentSupersession, filingReconciliation } = build({
        supersessionAvailable: false,
      });

      await expect(service.supersedeAmendments()).rejects.toThrow(
        /no database is bound/i,
      );
      expect(amendmentSupersession.supersedeAll).not.toHaveBeenCalled();
      expect(filingReconciliation.reconcileAll).not.toHaveBeenCalled();
    });

    // A half-done run is worse than a refused one: the rows would be gone and
    // the verdicts describing them stale. So an unavailable RECONCILIATION
    // must stop the supersede too — before it deletes anything. Moving that
    // check to be lazy (inside the chained reconcileFilings) must fail here.
    it('refuses before deleting when reconciliation could not follow', async () => {
      const { service, amendmentSupersession, filingReconciliation } = build({
        reconciliationAvailable: false,
      });

      await expect(service.supersedeAmendments()).rejects.toThrow(
        /no database is bound/i,
      );
      expect(amendmentSupersession.supersedeAll).not.toHaveBeenCalled();
      expect(filingReconciliation.reconcileAll).not.toHaveBeenCalled();
    });
  });
});
