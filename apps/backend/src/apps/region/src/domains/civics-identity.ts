/**
 * Merge the same civics entity arriving from several pages under one identity.
 *
 * `civics-grounding.ts` enforces identity *within* a page: when the page or the
 * source's hints warrant a type's full name, the name becomes the code, so the
 * classification "arrives under one identity from every page that names it".
 * When only the abbreviation is warranted, the abbreviation is kept, because
 * legitimate abbreviations exist and the Assembly glossary *defines* `AB`,
 * `ACA`, `ACR`, `AJR`.
 *
 * Both outcomes are correct per page, and together they mean `code` is
 * page-dependent. Keying the cross-page merge on `code` therefore splits one
 * type in two. Grounding's own comment anticipated this and said identity
 * across pages "needs the merge layer". This is that layer.
 *
 * Measured on the California region, 12 pages, sync of 2026-10-07 01:11 UTC:
 * **8 of 25 served measure types were duplicates of another entry** — `AB` and
 * `Assembly Bill`, `SB` and `Senate Bill`, and the same for ACA, ACR, AJR, SCA,
 * SCR and SJR. The region served 25 where the truth is 17.
 *
 * The fix rests on one measured fact: `name` is identical within every split
 * pair. Only `code` disagrees. So the name is the reliable key here — which is
 * exactly what is NOT true of lifecycle stages, where both the ids and the names
 * vary across pages and no reliable key exists in the extracted data at all
 * (39 served stages for ~25 real ones, `governor-action` carrying six different
 * names). That is #1341, and it needs a canonical-identity decision rather than
 * a merge-key change. Widening this module to cover it without that decision
 * would be guessing.
 *
 * `HR` and `SR` arrive as abbreviations with no spelled-out counterpart on any
 * page, so they are not splits. A merge that invented a full-name code for them
 * would be fabricating what no source supplied.
 */

/** The `CivicText` shape, structurally — avoids importing the GraphQL model. */
interface MergeableText {
  verbatim: string;
  plainLanguage: string;
  sourceUrl: string;
}

/** The subset of a measure type this module reasons about. */
export interface MergeableMeasureType {
  code: string;
  name: string;
  chamber: string;
  votingThreshold: string;
  reachesGovernor: boolean;
  purpose: MergeableText;
  lifecycleStageIds: string[];
}

export interface ReconcileResult<T> {
  /** The single entry both copies collapse into. */
  merged: T;
  /**
   * Human-readable disagreements on fields that are expected to agree.
   *
   * Empty for every pair in the measured data, which is precisely why it exists:
   * collapsing is lossless when copies agree and a judgement when they do not,
   * so a future disagreement should surface rather than be resolved in silence.
   * Same reasoning as `GroundingResult.conflicting`.
   */
  disagreements: string[];
}

export interface MergeConflict {
  /** The merged type's identity, for the log line. */
  type: string;
  disagreements: string[];
}

export interface MergeResult<T> {
  /** One entry per distinct measure type, in order of first appearance. */
  types: T[];
  /** Contradictions found while collapsing. Empty in the measured data. */
  conflicts: MergeConflict[];
}

/**
 * Fields that classify the type rather than describe it, and that were verified
 * to agree across all 25 rows of the 8 affected names. A disagreement here means
 * two pages contradict each other about what a measure type *is*, which is worth
 * a log line rather than a silent pick.
 */
const CLASSIFYING_FIELDS = [
  'chamber',
  'votingThreshold',
  'reachesGovernor',
] as const;

/** Case- and whitespace-insensitive identity, for keying and comparison. */
export function normaliseIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The key one measure type merges on: its name, or its code when the name is
 * missing.
 *
 * Falling back to the code matters — a row with a code and no name is still a
 * type, and keying it to the empty string would collapse every such row into
 * one entry.
 */
export function measureTypeKey(name: string, code: string): string {
  return normaliseIdentity(name) || normaliseIdentity(code);
}

/**
 * A code that merely repeats its own name is degenerate: it carries nothing the
 * name does not already say. `{ code: 'Assembly Bill', name: 'Assembly Bill' }`
 * is the grounding rule's canonical form, not an abbreviation.
 */
function isDegenerateCode(type: MergeableMeasureType): boolean {
  return normaliseIdentity(type.code) === normaliseIdentity(type.name);
}

/**
 * Prefer a real abbreviation over a code that repeats its name.
 *
 * This is the one deliberate judgement in the module. `code` is the short
 * identifier a citizen recognises from a bill number, so when one copy offers
 * `AB` and another offers `Assembly Bill`, `AB` is the better code and
 * `Assembly Bill` remains the name. Otherwise the incumbent keeps its code, so
 * the merge stays stable and order-independent among equally-informative copies.
 */
function preferAbbreviatedCode(
  existing: MergeableMeasureType,
  incoming: MergeableMeasureType,
): string {
  if (isDegenerateCode(existing) && !isDegenerateCode(incoming)) {
    return incoming.code;
  }
  return existing.code;
}

/**
 * Keep the more informative of two `CivicText` values, as a whole object.
 *
 * Whole object, never field-by-field: `sourceUrl` is the attestation for the
 * text beside it, so splicing `verbatim` from one page onto the `sourceUrl` of
 * another would produce a quote attributed to a page that does not contain it.
 *
 * Length is a crude proxy for informativeness, and it is used knowingly. The
 * measured spread is 3–4× (Assembly Bill 317 chars vs 105; ACR 509 vs 139; AJR
 * 478 vs 129), and the longer text consistently comes from the glossary and
 * legislative-process pages, which genuinely explain more than a status table
 * does. The principled alternative — prefer the copy whose name the page
 * warranted — is unavailable here because the warrant is not persisted on the
 * row. Recording it would make this a rule instead of a heuristic.
 */
function richerText(
  existing: MergeableText,
  incoming: MergeableText,
): MergeableText {
  const weight = (t: MergeableText): number =>
    t.verbatim.length + t.plainLanguage.length;
  return weight(incoming) > weight(existing) ? incoming : existing;
}

/**
 * Union the stage references, keeping first-seen order.
 *
 * Union rather than pick: the copies carry complementary subsets, not competing
 * claims. Assembly Bill arrived with 9, 11 and 8 stage ids from three pages, and
 * taking one set discarded stages the others had correctly linked.
 */
function unionStageIds(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

/**
 * Collapse two copies of one measure type into the entry to serve.
 *
 * Generic in `T` so the caller keeps its own concrete model type rather than
 * being handed this module's structural view of it.
 */
export function reconcileMeasureType<T extends MergeableMeasureType>(
  existing: T,
  incoming: T,
): ReconcileResult<T> {
  const disagreements = CLASSIFYING_FIELDS.filter(
    (field) => existing[field] !== incoming[field],
  ).map(
    (field) =>
      `${field}: ${String(existing[field])} vs ${String(incoming[field])}`,
  );

  return {
    merged: {
      ...existing,
      code: preferAbbreviatedCode(existing, incoming),
      name: existing.name || incoming.name,
      purpose: richerText(existing.purpose, incoming.purpose),
      lifecycleStageIds: unionStageIds(
        existing.lifecycleStageIds,
        incoming.lifecycleStageIds,
      ),
    },
    disagreements,
  };
}

/**
 * Collapse every copy of every measure type across all pages into one entry
 * each.
 *
 * **Identity runs in both directions, and it has to.** The first version of this
 * keyed on name alone, and an existing test caught the regression immediately:
 * two pages can also agree on the code and disagree on the name (`AB` →
 * "Assembly Bill" on one page, a different wording on another). Keying on name
 * alone split those, which is the same defect this module exists to fix, just
 * mirrored. So two entries are the same type when they share a normalised
 * **name** OR a normalised **code**:
 *
 *   AB            | Assembly Bill   ─┐ same name  → one type
 *   Assembly Bill | Assembly Bill   ─┘
 *
 *   AB            | Assembly Bill   ─┐ same code  → one type
 *   AB            | Assembly Bill*  ─┘
 *
 * Every alias a group has been seen under stays registered, so a third copy
 * matching either the name or any code already absorbed lands in the same
 * group. Within one region a code is an identifier, so sharing one is strong
 * evidence of sameness — and that was the pre-existing behaviour of this merge,
 * preserved deliberately rather than traded away.
 *
 * Order of first appearance is kept, so the served list is stable.
 */
export function mergeMeasureTypes<T extends MergeableMeasureType>(
  candidates: readonly T[],
): MergeResult<T> {
  /** Group index by every alias (name and code) that group answers to. */
  const groupByAlias = new Map<string, number>();
  const groups: T[] = [];
  const conflicts: MergeConflict[] = [];

  for (const candidate of candidates) {
    const aliases = typeAliases(candidate);
    const index = aliases
      .map((alias) => groupByAlias.get(alias))
      .find((found) => found !== undefined);

    if (index === undefined) {
      groups.push(candidate);
      registerAliases(groupByAlias, aliases, groups.length - 1);
      continue;
    }

    const { merged, disagreements } = reconcileMeasureType(
      groups[index],
      candidate,
    );
    groups[index] = merged;
    // Re-register: the merge may have adopted the incoming code, and the
    // incoming copy's own aliases must resolve here from now on.
    registerAliases(groupByAlias, typeAliases(merged).concat(aliases), index);

    if (disagreements.length > 0) {
      conflicts.push({
        type: measureTypeKey(merged.name, merged.code),
        disagreements,
      });
    }
  }

  return { types: groups, conflicts };
}

/** The normalised names and codes one entry should be found under. */
function typeAliases(type: MergeableMeasureType): string[] {
  const name = normaliseIdentity(type.name);
  const code = normaliseIdentity(type.code);
  // Deduplicated and empties dropped: a degenerate code equals its own name,
  // and an empty alias would match every other entry missing that field.
  return Array.from(new Set([name, code])).filter((alias) => alias.length > 0);
}

function registerAliases(
  groupByAlias: Map<string, number>,
  aliases: readonly string[],
  index: number,
): void {
  for (const alias of aliases) groupByAlias.set(alias, index);
}
