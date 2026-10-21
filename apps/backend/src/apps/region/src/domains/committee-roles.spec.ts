import type { CommitteeAssignment } from '@opuspopuli/common';
import {
  memberCommitteeNames,
  namedRoleGroups,
  normaliseRole,
  renderRoleClause,
} from './committee-roles';

const a = (role: string | null, name: string): CommitteeAssignment => ({
  role,
  name,
});

/**
 * Alvarez's real assignments (ca-assembly-80, read 2026-10-20). Every prompt
 * revision credited him with chairing three of the select committees he is
 * only a member of; this is the data that has to render exactly.
 */
const ALVAREZ: CommitteeAssignment[] = [
  a('Chair', 'Select Committee on California-Mexico Bi-National Affairs'),
  a('Chair', 'Subcommittee No. 3 on Education Finance'),
  a(
    'Co-Chair',
    'Select Committee on the Transportation Costs and Impact of the Low Carbon Fuel Standard',
  ),
  a('Member', 'Budget'),
  // The live row really does carry Budget twice.
  a('Member', 'Budget'),
  a('Member', 'Education'),
  a('Member', 'Governmental Organization'),
  a('Member', 'Insurance'),
  a('Member', 'Joint Legislative Budget'),
  a('Member', 'Rules'),
  a(
    'Member',
    'Select Committee on Developing Pathways to Purpose for Young Men',
  ),
  a('Member', 'Select Committee on Housing Construction Innovation'),
  a('Member', 'Water, Parks, and Wildlife'),
];

describe('normaliseRole', () => {
  it('maps the hyphenated variant onto the canonical spelling', () => {
    // Live data: 37 "Vice Chair" and exactly 1 "Vice-Chair". Untreated, that
    // one row renders as a fourth role group of one.
    expect(normaliseRole('Vice-Chair')).toBe('Vice Chair');
    expect(normaliseRole('Vice Chair')).toBe('Vice Chair');
  });

  it.each([
    ['Chairman', 'Chair'],
    ['chairwoman', 'Chair'],
    ['CO-CHAIR', 'Co-Chair'],
    ['co chair', 'Co-Chair'],
    ['  Vice   Chair  ', 'Vice Chair'],
  ])('normalises %s', (input, want) => {
    expect(normaliseRole(input)).toBe(want);
  });

  it('treats an absent role as Member', () => {
    expect(normaliseRole(null)).toBe('Member');
    expect(normaliseRole(undefined)).toBe('Member');
    expect(normaliseRole('   ')).toBe('Member');
  });

  it('passes an unrecognised role through verbatim', () => {
    // A new region may use a word this map has never seen. Printing it as
    // given is right where guessing at a mapping is not.
    expect(normaliseRole('Ranking Member')).toBe('Ranking Member');
  });
});

describe('namedRoleGroups', () => {
  it('groups Alvarez exactly, Members excluded', () => {
    expect(namedRoleGroups(ALVAREZ)).toEqual([
      {
        role: 'Chair',
        committees: [
          'Select Committee on California-Mexico Bi-National Affairs',
          'Subcommittee No. 3 on Education Finance',
        ],
      },
      {
        role: 'Co-Chair',
        committees: [
          'Select Committee on the Transportation Costs and Impact of the Low Carbon Fuel Standard',
        ],
      },
    ]);
  });

  it('orders roles canonically regardless of input order', () => {
    // The summary is content-hashed and stored, so incidental reordering
    // would read as a changed analysis on re-run.
    const groups = namedRoleGroups([
      a('Vice Chair', 'C'),
      a('Co-Chair', 'B'),
      a('Chair', 'A'),
    ]);

    expect(groups.map((g) => g.role)).toEqual([
      'Chair',
      'Co-Chair',
      'Vice Chair',
    ]);
  });

  it('collapses the same role and committee appearing twice', () => {
    const groups = namedRoleGroups([
      a('Chair', 'Budget'),
      a('Chair', 'Budget'),
    ]);

    expect(groups).toEqual([{ role: 'Chair', committees: ['Budget'] }]);
  });

  it('merges a hyphenated role into its canonical group', () => {
    const groups = namedRoleGroups([
      a('Vice Chair', 'Public Safety'),
      a('Vice-Chair', 'Labor and Employment'),
    ]);

    expect(groups).toEqual([
      {
        role: 'Vice Chair',
        committees: ['Public Safety', 'Labor and Employment'],
      },
    ]);
  });

  it('places an unrecognised role after the canonical ones, alphabetically', () => {
    const groups = namedRoleGroups([
      a('Ranking Member', 'Z'),
      a('Alternate', 'Y'),
      a('Chair', 'X'),
    ]);

    expect(groups.map((g) => g.role)).toEqual([
      'Chair',
      'Alternate',
      'Ranking Member',
    ]);
  });

  it('skips an assignment with no committee name', () => {
    expect(namedRoleGroups([a('Chair', '   '), a('Chair', 'Budget')])).toEqual([
      { role: 'Chair', committees: ['Budget'] },
    ]);
  });

  it('returns nothing when every assignment is plain membership', () => {
    expect(namedRoleGroups([a('Member', 'Budget'), a(null, 'Health')])).toEqual(
      [],
    );
  });
});

describe('memberCommitteeNames', () => {
  it('returns only the Member assignments, de-duplicated', () => {
    // Budget appears twice in the live row and must be offered once.
    expect(memberCommitteeNames(ALVAREZ)).toEqual([
      'Budget',
      'Education',
      'Governmental Organization',
      'Insurance',
      'Joint Legislative Budget',
      'Rules',
      'Select Committee on Developing Pathways to Purpose for Young Men',
      'Select Committee on Housing Construction Innovation',
      'Water, Parks, and Wildlife',
    ]);
  });

  it('excludes every named role, including an unrecognised one', () => {
    const names = memberCommitteeNames([
      a('Chair', 'A'),
      a('Vice-Chair', 'B'),
      a('Ranking Member', 'C'),
      a('Member', 'D'),
    ]);

    expect(names).toEqual(['D']);
  });

  it('treats a missing role as membership', () => {
    expect(memberCommitteeNames([a(null, 'Budget')])).toEqual(['Budget']);
  });
});

describe('renderRoleClause', () => {
  it('renders Alvarez with one clause per role', () => {
    // The sentence four prompt revisions could not produce correctly.
    expect(renderRoleClause('Alvarez', namedRoleGroups(ALVAREZ))).toBe(
      'Alvarez is Chair of the Select Committee on California-Mexico ' +
        'Bi-National Affairs and the Subcommittee No. 3 on Education Finance, ' +
        'and Co-Chair of the Select Committee on the Transportation Costs and ' +
        'Impact of the Low Carbon Fuel Standard.',
    );
  });

  it('adds the noun to a bare committee name', () => {
    // "Chair of Budget" is not English; "the Budget Committee" is, and the
    // field these came from is the representative's committees.
    expect(
      renderRoleClause('Dahle', [{ role: 'Chair', committees: ['Budget'] }]),
    ).toBe('Dahle is Chair of the Budget Committee.');
  });

  it('does not add the noun to an already-qualified name', () => {
    expect(
      renderRoleClause('Ahrens', [
        { role: 'Chair', committees: ['Joint Committee on Rules'] },
      ]),
    ).toBe('Ahrens is Chair of the Joint Committee on Rules.');
  });

  it('renders a bare name verbatim, inferring no chamber', () => {
    // "Assembly Committee on Budget" would be an inference about which
    // chamber's committee it is — the one the model made freely. Asserted as
    // the exact output: `not.toMatch(/Assembly|Senate/)` was a property of
    // code that does not exist, since nothing here knows the chamber, so
    // even `renderCommitteeName` returning the bare name passed it.
    expect(
      renderRoleClause('Dahle', [{ role: 'Chair', committees: ['Budget'] }]),
    ).toBe('Dahle is Chair of the Budget Committee.');
  });

  it('renders two committees under one role without repeating the role', () => {
    expect(
      renderRoleClause('Alanis', [
        {
          role: 'Vice Chair',
          committees: ['Labor and Employment', 'Public Safety'],
        },
      ]),
    ).toBe(
      'Alanis is Vice Chair of the Labor and Employment Committee and the ' +
        'Public Safety Committee.',
    );
  });

  it('uses an Oxford comma for three or more', () => {
    expect(
      renderRoleClause('X', [{ role: 'Chair', committees: ['A', 'B', 'C'] }]),
    ).toBe(
      'X is Chair of the A Committee, the B Committee, and the C Committee.',
    );
  });

  it('comma-separates two role clauses, so the lists cannot merge', () => {
    // Without the comma this reads "Chair of A and B and Co-Chair of C",
    // which can be parsed as chairing only A — the ambiguity that defeats
    // the whole reason roles are rendered in code.
    const clause = renderRoleClause('X', [
      { role: 'Chair', committees: ['A', 'B'] },
      { role: 'Co-Chair', committees: ['C'] },
    ]);

    expect(clause).toBe(
      'X is Chair of the A Committee and the B Committee, and Co-Chair of ' +
        'the C Committee.',
    );
  });

  it('skips a role group that carries no committees', () => {
    // Exported, so a caller can hand it this shape. Unguarded it renders
    // "X is Chair of ." — a sentence asserting a chairmanship of nothing.
    expect(
      renderRoleClause('X', [
        { role: 'Chair', committees: [] },
        { role: 'Co-Chair', committees: ['A'] },
      ]),
    ).toBe('X is Co-Chair of the A Committee.');
  });

  it('is empty when every group carries no committees', () => {
    expect(renderRoleClause('X', [{ role: 'Chair', committees: [] }])).toBe('');
  });

  it('is empty when there are no named roles', () => {
    expect(renderRoleClause('Bains', [])).toBe('');
  });
});
