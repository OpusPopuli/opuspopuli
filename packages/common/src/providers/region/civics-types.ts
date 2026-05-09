/**
 * Civics-data types — the response shape of the civics-extraction
 * prompt + the runtime shape stored in DB and exposed via GraphQL.
 *
 * The extractor (private prompt-service) instructs the LLM to
 * produce JSON matching `CivicsBlock`. Every text field that has a
 * lay reading is wrapped in `CivicText`, which carries BOTH the
 * verbatim source text (institutional language) AND a plain-language
 * rewrite for laypeople. Both must be present — the rewrite never
 * replaces the verbatim. This is the trust + auditability contract:
 * a civic-knowledge platform that paraphrases without showing the
 * source loses credibility.
 *
 * Identifiers and proper nouns (`code: "AB"`, `id: "committee"`,
 * `name: "Assembly"` for chambers, etc.) stay as plain strings —
 * there's no lay rewrite for "Assembly Bill" or "AB".
 *
 * See OpusPopuli/opuspopuli#669 + OpusPopuli/opuspopuli-regions#15.
 */

/**
 * Verbatim source text + AI-generated plain-language rewrite,
 * both stored together. The rewrite targets a typical voter
 * (high-school senior reading level), NOT a lawyer. The verbatim
 * is what the source page literally says.
 */
export interface CivicText {
  /** Exact source text, untouched by AI. */
  verbatim: string;
  /** AI rewrite for a typical voter. Never replaces verbatim. */
  plainLanguage: string;
  /** Source URL the verbatim came from (for citation + audit). */
  sourceUrl: string;
}

/**
 * Vote threshold required for passage. Drives invariant validation
 * (e.g. "urgency on majority-only measure type → reject").
 */
export type VotingThreshold =
  | "majority"
  | "two-thirds"
  | "three-fifths"
  | "unanimous";

/**
 * Citizen-action verb. Drives UI iconography on the lifecycle
 * progress bar's "What can I do?" callout.
 */
export type CitizenActionVerb =
  | "comment"
  | "attend"
  | "contact"
  | "monitor"
  | "vote"
  | "learn";

/**
 * Visual urgency tier for the citizen-action callout.
 * `active` = orange CTA, action window open right now.
 * `passive` = gray, informational.
 * `none` = hide the CTA entirely.
 */
export type CitizenActionUrgency = "active" | "passive" | "none";

/**
 * How legislative sessions are numbered/named.
 */
export type SessionCadence = "annual" | "biennial" | "continuous";

export interface Chamber {
  /** Proper noun, no lay rewrite (e.g. "Assembly", "Senate"). */
  name: string;
  /** Short form used in measure-type codes (e.g. "A" for AB). */
  abbreviation: string;
  /** Number of seats. */
  size: number;
  /** Length of one term, in years. */
  termYears: number;
  /** Named leadership positions; proper nouns, no rewrite. */
  leadershipRoles: string[];
  /** Plain-language description of this chamber + its role. */
  description: CivicText;
}

export interface MeasureType {
  /** Canonical code as it appears in scraped externalIds (e.g. "AB", "ACA"). */
  code: string;
  /** Full name; proper noun (e.g. "Assembly Constitutional Amendment"). */
  name: string;
  /** Originating chamber; matches a Chamber.name. */
  chamber: string;
  votingThreshold: VotingThreshold;
  /** True if this measure type is presented to the executive for signature. */
  reachesGovernor: boolean;
  /** What this measure type does + what makes it different from siblings. */
  purpose: CivicText;
  /** Ordered LifecycleStage.id values this measure type can pass through. */
  lifecycleStageIds: string[];
}

export interface CitizenAction {
  verb: CitizenActionVerb;
  /** User-facing button copy + lay rewrite. */
  label: CivicText;
  /** Optional link target (omit for monitor/learn verbs without a canonical destination). */
  url?: string;
  urgency: CitizenActionUrgency;
}

export interface LifecycleStage {
  /** Stable identifier (slug, e.g. "committee"). Stored on Proposition.lifecycleStageId. */
  id: string;
  /** Display name (e.g. "In committee"). */
  name: CivicText;
  /** One-line description for L1/L2 surfaces. */
  shortDescription: CivicText;
  /** Optional longer description for L4 civics hub. */
  longDescription?: CivicText;
  /**
   * Regex patterns (JS regex syntax, no surrounding slashes) the
   * pipeline tries against raw scraped status strings to map them
   * to this stage. First match wins. Empty array means this stage
   * is reached only by inference (rare).
   */
  statusStringPatterns: string[];
  /** What a constituent can DO when a bill is at this stage. */
  citizenAction?: CitizenAction;
}

export interface SessionScheme {
  cadence: SessionCadence;
  /** Display template (e.g. "{startYear}-{endYear}" for biennial). */
  namingPattern: string;
  /** Plain-language explanation of how sessions work in this region. */
  description: CivicText;
}

export interface GlossaryEntry {
  /** The term being defined (case-insensitive lookup at runtime). */
  term: string;
  /** URL-safe anchor for deep-linking from <CivicTerm>. */
  slug: string;
  /** Definition — verbatim source text + lay rewrite. */
  definition: CivicText;
  /** Optional longer definition for the civics hub. */
  longDefinition?: CivicText;
  /** Cross-references to other glossary terms (case-insensitive). */
  relatedTerms: string[];
}

/**
 * Top-level civics block. The LLM produces this shape; the pipeline
 * persists it; consumers (UI, LifecycleStageMapper, CivicInvariantValidator)
 * read it from the DB.
 *
 * `sessionScheme` is `| null` because civics is extracted per source URL
 * — a glossary page or a how-a-bill-becomes-law page typically does not
 * describe the session scheme, and the prompt is instructed to emit
 * `null` rather than fabricate one. Consumers merge across multiple
 * source extractions; sessionScheme should be present in at least one.
 */
export interface CivicsBlock {
  chambers: Chamber[];
  measureTypes: MeasureType[];
  lifecycleStages: LifecycleStage[];
  sessionScheme: SessionScheme | null;
  glossary: GlossaryEntry[];
}
