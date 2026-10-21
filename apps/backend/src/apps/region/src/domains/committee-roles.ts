import type { CommitteeAssignment } from '@opuspopuli/common';

/** One role, and every committee held under it. */
export interface RoleGroup {
  /** Canonical role name, as it should be printed. */
  role: string;
  /** Committee names, verbatim from the source data. */
  committees: string[];
}

/**
 * Roles that are not "Member", in print order, with their canonical spelling.
 *
 * Order is fixed rather than data-driven so two reps with the same roles
 * produce the same sentence shape, and a re-run produces the same text — the
 * summary is content-hashed and stored, so incidental reordering would read
 * as a changed analysis.
 */
const CANONICAL_ROLES = ['Chair', 'Co-Chair', 'Vice Chair'] as const;

/** Spelling variants seen in the data, mapped to their canonical form. */
const ROLE_ALIASES = new Map<string, string>([
  ['chair', 'Chair'],
  ['chairman', 'Chair'],
  ['chairwoman', 'Chair'],
  ['chairperson', 'Chair'],
  ['cochair', 'Co-Chair'],
  ['co chair', 'Co-Chair'],
  ['co-chair', 'Co-Chair'],
  ['vicechair', 'Vice Chair'],
  ['vice chair', 'Vice Chair'],
  // Present in the live data exactly once, against 37 of "Vice Chair".
  // Without this it renders as a fourth role group of one.
  ['vice-chair', 'Vice Chair'],
  ['member', 'Member'],
]);

/**
 * Words that assert a role.
 *
 * Lives beside {@link ROLE_ALIASES} because it has to stay in step with it.
 * The committee-summary prompt is handed membership names with NO roles, so
 * any role word in its output is invented — and a detector that does not know
 * a vocabulary entry silently lets that through. Declared apart from the
 * aliases, adding one could quietly blind the guard.
 */
export const ROLE_CLAIM =
  /\b(?:vice[-\s]?chairs?|co[-\s]?chairs?|chairs?|chair(?:man|woman|person)|presides|heads|leads)\b/i;

/** Names already carrying the kind of body they are, so needing no noun. */
const QUALIFIED_BODY =
  /\b(committee|subcommittee|caucus|commission|board|task force)\b/i;

/**
 * Canonical form of a role, or `Member` when the source names none.
 *
 * An unrecognised role is returned trimmed but otherwise verbatim: a new
 * region may use a word this list has never seen, and printing it as given is
 * right where guessing at a mapping is not.
 */
export function normaliseRole(role: string | null | undefined): string {
  const trimmed = (role ?? '').trim();
  if (!trimmed) return 'Member';
  return (
    ROLE_ALIASES.get(trimmed.toLowerCase().replaceAll(/\s+/g, ' ')) ?? trimmed
  );
}

/** Whether an assignment carries no role beyond plain membership. */
function isMember(assignment: CommitteeAssignment): boolean {
  return normaliseRole(assignment.role) === 'Member';
}

/**
 * Group the assignments that carry a role other than Member (#1393).
 *
 * This is the half of the summary that must be exact, so it is computed here
 * rather than asked for: `role` and `name` arrive as structured fields and
 * there is nothing in the pairing to interpret.
 *
 * Measured on the five reps the generator reaches first in UAT (80
 * assignments, 13-20 each), four successive revisions of the prompt produced
 * between 4 and 15 FALSE role claims — a legislator credited with chairing a
 * committee they merely sit on. The model handles one named role and starts
 * misattributing at two or three, because a long enumeration drifts past the
 * bodies a role word governs. No wording fixed it, and nothing about the task
 * needs a model: see `docs/evals/2026-10-20-representatives-prompt-tuning.md`.
 *
 * Duplicates are collapsed. The live data contains the same assignment twice
 * for at least one rep, which would otherwise print the committee twice.
 *
 * @param committees - Assignments as stored on the representative
 * @returns Groups in canonical order, each with de-duplicated committee names
 */
export function namedRoleGroups(
  committees: readonly CommitteeAssignment[],
): RoleGroup[] {
  const byRole = new Map<string, string[]>();

  for (const assignment of committees) {
    if (isMember(assignment)) continue;
    const name = assignment.name?.trim();
    if (!name) continue;

    const role = normaliseRole(assignment.role);
    const names = byRole.get(role) ?? [];
    if (!names.includes(name)) names.push(name);
    byRole.set(role, names);
  }

  // Canonical roles first in fixed order, then anything unrecognised,
  // alphabetically — still deterministic, just not privileged. Built from
  // the map's entries so no lookup can miss.
  const rank = (role: string) => {
    // Widened to `readonly string[]` rather than asserting the argument is a
    // member of the literal union — the whole question being asked is
    // whether it is one.
    const index = (CANONICAL_ROLES as readonly string[]).indexOf(role);
    return index === -1 ? CANONICAL_ROLES.length : index;
  };

  return [...byRole.entries()]
    .map(([role, names]) => ({ role, committees: names }))
    .sort(
      (a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role),
    );
}

/**
 * De-duplicated names of the plain-Member assignments.
 *
 * This is all the LLM is given. With no roles in its input it cannot
 * misattribute one, which is what makes the error class above unreachable
 * rather than merely rarer.
 */
export function memberCommitteeNames(
  committees: readonly CommitteeAssignment[],
): string[] {
  const names: string[] = [];
  for (const assignment of committees) {
    if (!isMember(assignment)) continue;
    const name = assignment.name?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Render one committee name as it should read inside a sentence.
 *
 * Names arrive in two shapes: fully qualified ("Select Committee on Child
 * Care Costs", "Subcommittee No. 3 on Education Finance") and bare
 * ("Budget", "Water, Parks, and Wildlife"). A bare name needs the noun to
 * read as English — "Chair of Budget" does not. Adding "Committee" invents
 * nothing: the field these came from is the representative's committees.
 *
 * It deliberately does NOT expand to "Assembly Committee on Budget". Which
 * chamber's committee it is would be an inference, and the one the LLM made
 * freely in earlier revisions.
 */
function renderCommitteeName(name: string): string {
  return QUALIFIED_BODY.test(name) ? `the ${name}` : `the ${name} Committee`;
}

/** "A", "A and B", "A, B, and C" — ordinary prose. */
function joinProse(items: string[]): string {
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return joinWithFinalAnd(items);
}

/**
 * Join the role clauses, always comma-separated — including at two.
 *
 * Each clause already joins its own committees with "and", so joining the
 * clauses with a bare "and" too would leave the reader unable to see where
 * one role's list ends: "Chair of A and B and Co-Chair of C" can be read as
 * chairing only A. Telling the reader which committees fall under which role
 * is the entire point of rendering this in code, so the comma stays even
 * where ordinary prose would drop it.
 */
function joinClauses(clauses: string[]): string {
  return joinWithFinalAnd(clauses);
}

/** "A", "A, and B", "A, B, and C" — the tail both joiners share. */
function joinWithFinalAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/**
 * The exact sentence naming every role the representative holds.
 *
 * One clause per role, so no role word ever governs a committee held under a
 * different one — the failure this replaces. Empty when there are no named
 * roles, which is the common case.
 *
 * @param subject - How to refer to the representative, usually the surname
 * @param groups - Output of {@link namedRoleGroups}
 */
export function renderRoleClause(subject: string, groups: RoleGroup[]): string {
  // A group with no committees would render "X is Chair of ." — this is an
  // exported function, so the shape has to be rejected here rather than
  // assumed away.
  const populated = groups.filter((group) => group.committees.length > 0);
  if (populated.length === 0) return '';

  const clauses = populated.map(
    (group) =>
      `${group.role} of ${joinProse(group.committees.map(renderCommitteeName))}`,
  );

  return `${subject} is ${joinClauses(clauses)}.`;
}
