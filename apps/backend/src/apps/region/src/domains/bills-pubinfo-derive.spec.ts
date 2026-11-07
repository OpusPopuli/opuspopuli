import {
  authorHouse,
  billNumber,
  camlTitle,
  clip,
  foldName,
  isSeatHolder,
  lastAction,
  latestVersion,
  legislatorKey,
  normalizeLegislatorName,
  rollCallKey,
  seatKey,
  sessionLabel,
  voteChamber,
  voteHouse,
  votePosition,
} from './bills-pubinfo-derive';

describe('bills-pubinfo-derive (bills-phase-b.md, D15-D17)', () => {
  it('labels a session as bills already do', () => {
    expect(sessionLabel('20252026')).toBe('2025-2026');
    expect(sessionLabel('2025-2026')).toBe('2025-2026');
  });

  it('numbers a bill as bills already do', () => {
    expect(billNumber('AB', 1165)).toBe('AB 1165');
  });

  it('takes the lowest version number as the current version', () => {
    expect(
      latestVersion([
        { versionNum: 99 },
        { versionNum: 94 },
        { versionNum: 97 },
      ]),
    ).toEqual({ versionNum: 94 });
    expect(latestVersion([])).toBeUndefined();
  });

  it('takes the newest action, by date then sequence', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const last = lastAction([
      {
        externalId: '4',
        actionDate: d('2026-08-01'),
        action: 'first',
        actionSequence: 9,
      },
      {
        externalId: '2',
        actionDate: d('2026-09-01'),
        action: 'early',
        actionSequence: 1,
      },
      {
        externalId: '1',
        actionDate: d('2026-09-01'),
        action: 'late',
        actionSequence: 2,
      },
      {
        externalId: '9',
        actionDate: null,
        action: 'undated',
        actionSequence: 99,
      },
    ]);
    expect(last?.action).toBe('late');
  });

  it('clips a subject to the column, marking the cut', () => {
    expect(clip('short', 500)).toBe('short');
    expect(clip(null, 500)).toBeNull();
    const cut = clip('x'.repeat(600), 500)!;
    expect(cut).toHaveLength(500);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('orders history ids numerically, and does not throw on one that is not', () => {
    const d = new Date('2026-08-31T00:00:00Z');
    const at = (externalId: string, action: string) => ({
      externalId,
      actionDate: d,
      action,
      actionSequence: 1,
    });
    expect(lastAction([at('99', 'earlier'), at('100', 'later')])?.action).toBe(
      'later',
    );
    expect(() => lastAction([at('x1', 'a'), at('100', 'b')])).not.toThrow();
  });

  it('breaks a tied sequence by history id, whatever the load order', () => {
    const d = new Date('2026-08-31T00:00:00Z');
    // AB 133 on 2026-11-05: both actions carry sequence 11.
    const rows = [
      {
        externalId: '118906811',
        actionDate: d,
        action: 'Read second time.',
        actionSequence: 11,
      },
      {
        externalId: '118906810',
        actionDate: d,
        action: 'From committee: Do pass.',
        actionSequence: 11,
      },
    ];
    expect(lastAction(rows)?.action).toBe('Read second time.');
    expect(lastAction([...rows].reverse())?.action).toBe('Read second time.');
  });

  it('reads the long title from CAML, without tags or entities', () => {
    expect(
      camlTitle(
        '<x><caml:Title>An act to amend <b>Section 1</b> &amp; more.\n </caml:Title></x>',
      ),
    ).toBe('An act to amend Section 1 & more.');
    expect(camlTitle('<x/>')).toBeUndefined();
    expect(camlTitle(null)).toBeUndefined();
  });

  it('maps vote codes to the positions bill_votes holds (D16)', () => {
    expect(votePosition('AYE')).toBe('yes');
    expect(votePosition('NOE')).toBe('no');
    expect(votePosition('ABS')).toBe('no_vote');
    expect(votePosition('XYZ')).toBeUndefined();
    expect(votePosition(null)).toBeUndefined();
  });

  it('reads the house of a roll call from its location', () => {
    expect(voteHouse('AFLOOR')).toBe('A');
    expect(voteHouse('CX25')).toBe('A');
    expect(voteHouse('SFLOOR')).toBe('S');
    expect(voteHouse('CS61')).toBe('S');
    expect(voteHouse('ZZ')).toBeUndefined();
  });

  it('names a vote chamber as bill_votes does (D16)', () => {
    expect(voteChamber('AFLOOR', 'Assembly Floor')).toBe('Assembly');
    expect(voteChamber('SFLOOR', 'Senate Floor')).toBe('Senate');
    expect(voteChamber('CX25', 'Asm Appropriations')).toBe(
      'Assembly Appropriations',
    );
    expect(voteChamber('CS61', 'Sen Appropriations')).toBe(
      'Senate Appropriations',
    );
    expect(voteChamber('CX99', undefined)).toBe('CX99');
  });

  it('keys a roll call by location, time and sequence', () => {
    const second = rollCallKey('AFLOOR', '2026-08-31 10:00:00', 1);
    expect(second).toBe('AFLOOR:2026-08-31 10:00:00:1');
    expect(rollCallKey('AFLOOR', '2026-08-31 10:00:00', 2)).not.toBe(second);
    expect(rollCallKey('AFLOOR', '2026-08-31 14:00:00', 1)).not.toBe(second);
  });

  it('strips the stray prefixes author lists carry', () => {
    expect(normalizeLegislatorName(': Schiavo')).toBe('Schiavo');
    expect(normalizeLegislatorName('Senator Seyarto')).toBe('Seyarto');
    expect(normalizeLegislatorName('Weber Pierson')).toBe('Weber Pierson');
  });

  it('keys a legislator by session, house and normalized name', () => {
    expect(legislatorKey('20252026', 'S', 'Senator Seyarto')).toBe(
      legislatorKey('20252026', 'S', 'seyarto'),
    );
    expect(legislatorKey('20252026', 'A', 'Smith')).not.toBe(
      legislatorKey('20252026', 'S', 'Smith'),
    );
  });

  it('keys a seat as representatives store it (D15)', () => {
    expect(seatKey('AD78')).toBe('Assembly|78');
    expect(seatKey('SD02')).toBe('Senate|2');
    expect(seatKey('XD01')).toBeUndefined();
  });

  it('folds case and accents out of a name', () => {
    expect(foldName('Ávila Farías')).toBe(foldName('Avila Farias'));
  });

  it('links a legislator only to the member holding the seat now (D15)', () => {
    expect(isSeatHolder('Anamarie Ávila Farías', 'Avila Farias')).toBe(true);
    // A predecessor, and the former member of a seat now vacant.
    expect(isSeatHolder('Ada Successor', 'Predecessor')).toBe(false);
    expect(isSeatHolder('Member Vacant', 'Former')).toBe(false);
    expect(isSeatHolder('Ada Example', null)).toBe(false);
    // Whole words: a short name inside another is not a match.
    expect(isSeatHolder('Kathleen Smith', 'Lee')).toBe(false);
    expect(isSeatHolder('Ana Ávila-Farías', 'Avila Farias')).toBe(true);
    expect(isSeatHolder('John Smith', 'Smith Jr.')).toBe(true);
    expect(isSeatHolder('Pat O’Brien', "O'Brien")).toBe(true);
  });

  it('reads an author row house', () => {
    expect(authorHouse('ASSEMBLY')).toBe('A');
    expect(authorHouse('SENATE')).toBe('S');
    expect(authorHouse(null)).toBeUndefined();
  });
});
