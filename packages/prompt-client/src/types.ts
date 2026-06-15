/**
 * Prompt Client Types
 */

import type {
  DataType,
  PromptServiceResponse,
  ICache,
} from "@opuspopuli/common";
import type { PromptTemplate } from "@opuspopuli/relationaldb-provider";

/**
 * Configuration for the prompt client.
 */
export interface PromptClientConfig {
  /** URL of remote AI Prompt Service (undefined = read from DB) */
  promptServiceUrl?: string;
  /** API key — required when url is set (used for Bearer or HMAC signing) */
  promptServiceApiKey?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;

  /** Node UUID for HMAC signing. When set (along with apiKey), uses HMAC auth instead of Bearer. */
  hmacNodeId?: string;

  /** Max retry attempts for remote calls (default: 3) */
  retryMaxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  retryBaseDelayMs?: number;
  /** Max delay in ms between retries (default: 10000) */
  retryMaxDelayMs?: number;

  /** Failure threshold before opening circuit (default: 3) */
  circuitBreakerFailureThreshold?: number;
  /** Time in ms before testing half-open (default: 15000) */
  circuitBreakerHalfOpenMs?: number;

  /** External cache instance (e.g., Redis-backed). When undefined, uses MemoryCache. */
  cache?: ICache<PromptTemplate>;
  /** Cache TTL in ms for template entries (default: 300000 = 5 min) */
  cacheTtlMs?: number;
  /** Maximum in-memory cache entries (default: 50, only used for built-in MemoryCache) */
  cacheMaxSize?: number;

  /**
   * Upper-bound TTL (ms) for the remote-template cache (#729). Per-entry
   * freshness is governed by the server's `expiresAt` (typically 1 hour);
   * this is the MemoryCache eviction ceiling. Set above the server's
   * PROMPT_TTL_SECONDS so the hash-revalidation flow has time to extend
   * entries. Default 24 hours.
   */
  remoteCacheMaxTtlMs?: number;
}

/**
 * Parameters for structural analysis prompt.
 */
export interface StructuralAnalysisParams {
  dataType: DataType;
  contentGoal: string;
  category?: string;
  hints?: string[];
  html: string;
}

/**
 * Parameters for document analysis prompt.
 */
export interface DocumentAnalysisParams {
  documentType: string;
  text: string;
}

/**
 * Parameters for RAG prompt.
 */
export interface RAGParams {
  context: string;
  query: string;
}

/**
 * Parameters for civics-extraction prompt — produces a structured
 * `CivicsBlock` with verbatim source text + plain-language rewrites
 * from a region's official civic-process pages.
 *
 * The LLM returns JSON matching `@opuspopuli/common`'s `CivicsBlock`
 * shape. Each text field that has a lay reading carries BOTH the
 * verbatim source text AND a plain-language rewrite for a typical
 * voter — never one without the other. See
 * OpusPopuli/opuspopuli#669 + OpusPopuli/opuspopuli-regions#15.
 */
export interface CivicsExtractionParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** URL the HTML/text was scraped from (for citation in `CivicText.sourceUrl`). */
  sourceUrl: string;
  /** Natural-language extraction goal from the region config's `dataSource.contentGoal`. */
  contentGoal: string;
  /** Optional sub-category from the region config (e.g. "Assembly", "Senate"). */
  category?: string;
  /** Optional hints from the region config to disambiguate / scope extraction. */
  hints?: string[];
  /** Raw HTML or text content scraped from `sourceUrl`. */
  html: string;
}

/**
 * Parameters for bill-extraction prompt — produces a structured `Bill`
 * record from an individual bill page on an official legislature website
 * (leginfo.legislature.ca.gov for California). Issue #686.
 *
 * The LLM returns JSON matching `@opuspopuli/common`'s `Bill` shape,
 * including raw author/co-author name strings and a `votes[]` array of
 * per-member roll-call positions extracted from the bill's vote-history
 * section.
 */
export interface BillExtractionParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** URL the HTML was scraped from — becomes Bill.sourceUrl. */
  sourceUrl: string;
  /** Legislative session inferred from the URL or page content, e.g. "2023-2024". */
  sessionYear: string;
  /** Raw HTML of the bill detail page. */
  html: string;
}

/**
 * Parameters for bill-analysis prompt — produces a structured plain-English
 * summary of a legislative bill for the personalization pipeline. The LLM
 * returns JSON of shape `{ plainEnglishSummary, topics[], whoItAffects[],
 * fiscalImpact: { level, summary }, stakeholderImpact }`, with controlled
 * vocabularies that match the user-profile schema. Epic #740, this issue #741.
 *
 * Variable shape MUST stay in lockstep with the bill-analysis template
 * descriptor in prompt-service — both the variable names and the wrapping
 * applied to optional fields. The wrapping for OFFICIAL_SUMMARY_BLOCK and
 * FISCAL_IMPACT_BLOCK is intentional: those strings are extracted from
 * upstream scraping and must be presented to the LLM as untrusted content
 * (fenced, below the SECURITY NOTICE), not as trusted input metadata.
 */
export interface BillAnalysisParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Display bill number (e.g. "AB 1", "SB 500"). */
  billNumber: string;
  /** Legislative session, e.g. "2025-2026". */
  sessionYear: string;
  /** Full official bill title as it appears on the source page. */
  title: string;
  /** Subject tag from the bill page if present (e.g. "Taxation: property tax: exemptions"). */
  subject?: string;
  /** Verbatim current status (framing context only, not part of the summary output). */
  status?: string;
  /** Primary author full name as listed on the bill page. */
  authorName?: string;
  /** Verbatim official summary (legislative-counsel digest etc.) if available. Boosts summary fidelity. */
  officialSummary?: string;
  /** Verbatim fiscal-impact summary from the Fiscal Committee / legislative analyst. Sets fiscalImpact.level. */
  fiscalImpactSummary?: string;
  /** Full bill text — caller is responsible for truncation to its token budget. */
  fullText: string;
}

/**
 * Params for the `bill-relevance-explanation` prompt. Couples the
 * structured bill summary from `bill-analysis` (opuspopuli #741) with
 * the user's anonymized declared signals — the only inputs the LLM
 * needs to write the per-user-per-bill "why this matters to you"
 * sentence (planning doc §5.2, §5.3). Consumed by the nightly batch
 * job in the knowledge service (opuspopuli #745).
 *
 * Privacy boundary (planning doc §10 commitment 7): callers MUST pass
 * only declared signals — boolean flag names from the 20 RankingFlags
 * (TRUE-only) + controlled-vocab interest tag slugs + a coarse region
 * label. NEVER raw addresses, sensitive T3 fields, or behavioral data.
 * Anonymization happens in the caller, not here.
 */
export interface BillRelevanceExplanationParams {
  // ---------- Bill context ----------
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Display bill number (e.g. "AB 1", "SB 500"). */
  billNumber: string;
  /** Legislative session, e.g. "2025-2026". */
  sessionYear: string;
  /** Full official bill title. */
  title: string;

  // ---------- Bill structured summary (from bill-analysis) ----------
  /** 2-3 sentence plain-English summary from bill-analysis output. */
  plainEnglishSummary: string;
  /** Controlled-vocab topic slugs from bill-analysis (1-3 values). */
  topics: string[];
  /** Controlled-vocab whoItAffects slugs from bill-analysis (0-4 values). */
  whoItAffects: string[];
  /** Normalized fiscal-impact level from bill-analysis. */
  fiscalImpactLevel?: "none" | "low" | "medium" | "high";
  /** One-sentence fiscal-impact summary from bill-analysis. */
  fiscalImpactSummary?: string;
  /** One-sentence stakeholder-impact summary from bill-analysis. */
  stakeholderImpact?: string;
  /** Optional bill section reference (e.g. "Section 1947.12") — passed through verbatim. */
  billSectionHint?: string;

  // ---------- User anonymized profile ----------
  /** User's declared interest tags (controlled-vocab slugs — same vocab as `topics`). */
  userInterestTags: string[];
  /** Names of the 20 boolean RankingFlags that are TRUE for this user. Only declared signals — never inferred T3. */
  userRankingFlags: string[];
  /** Coarse anonymized region label (e.g. "94xxx", "alameda-county"). Caller anonymizes; this never sees raw addresses. */
  userRegionLabel?: string;
}

/**
 * Params for the `proposition-relevance-explanation` prompt — extends the
 * universal `relevanceReason` UX contract to ballot propositions
 * (opuspopuli#836). Cross-repo contract mirrors
 * `PropositionRelevanceExplanationDto` (prompt-service#79). When the template
 * gains new variables, update both the service-side seed and the
 * `composePropositionRelevanceExplanation` variable map.
 *
 * Privacy boundary: same as BillRelevanceExplanationParams — only declared
 * signals reach the prompt-service. NEVER raw addresses, sensitive T3 fields,
 * or behavioral data. Anonymization happens in the caller.
 */
export interface PropositionRelevanceExplanationParams {
  // ---------- Proposition context ----------
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Proposition display number (e.g. "Measure J", "Prop 12"). */
  propositionNumber: string;
  /** Election date in YYYY-MM-DD format. */
  electionDate: string;
  /** Full official proposition title. */
  title: string;

  // ---------- Proposition structured summary ----------
  /** 2-3 sentence plain-English summary of the measure. */
  plainEnglishSummary: string;
  /** Controlled-vocab topic slugs (1-3 values). Shares bill-analysis vocab. */
  topics: string[];
  /** Controlled-vocab whoItAffects slugs (0-4 values). */
  whoItAffects: string[];
  /** Normalized fiscal-impact level. */
  fiscalImpactLevel?: "none" | "low" | "medium" | "high";
  /** One-sentence fiscal-impact summary. */
  fiscalImpactSummary?: string;
  /** One-sentence stakeholder-impact summary. */
  stakeholderImpact?: string;
  /** Optional provision reference (e.g. "Section 3", "the parental-consent clause") — passed through verbatim. */
  provisionHint?: string;

  // ---------- User anonymized profile ----------
  /** User's declared interest tags (controlled-vocab slugs — same vocab as `topics`). */
  userInterestTags: string[];
  /** Names of the boolean RankingFlags that are TRUE for this user. Only declared signals — never inferred T3. */
  userRankingFlags: string[];
  /** Coarse anonymized region label. Caller anonymizes; this never sees raw addresses. */
  userRegionLabel?: string;
}

/**
 * Params for the `representative-relevance-explanation` prompt — extends the
 * `relevanceReason` contract to elected representatives (opuspopuli#836).
 * Cross-repo contract mirrors `RepresentativeRelevanceExplanationDto`
 * (prompt-service#80).
 *
 * The template forbids speculation about the rep's beliefs, motives, or
 * future votes — only documented jurisdictional facts (committee
 * assignments, topic focus, recent actions) become anchors.
 */
export interface RepresentativeRelevanceExplanationParams {
  // ---------- Rep context ----------
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Display name (e.g. "Rep. Zoe Lofgren"). */
  repName: string;
  /** Office title with chamber + district (e.g. "U.S. House CA-18"). */
  officeTitle: string;
  /** Jurisdiction scope. */
  jurisdiction: "federal" | "state" | "county" | "city";
  /** Informational party label — template forbids editorial use. */
  party?: "democrat" | "republican" | "independent" | "nonpartisan";

  // ---------- Rep structured facts (anchor candidates) ----------
  /** 1-2 sentence plain-English description of the office. */
  mandateSummary: string;
  /** Controlled-vocab topics the rep has been active on this session (0-3). */
  topicsOfFocus: string[];
  /** Committee names the rep currently sits on (0-6). */
  committeeMemberships: string[];
  /** One-sentence verbatim description of the rep's most recent meaningful action. */
  recentLegislativeAction?: string;
  /** Optional single-line description of an upcoming public event. */
  upcomingEvent?: string;

  // ---------- User anonymized profile ----------
  /** User's declared interest tags. */
  userInterestTags: string[];
  /** Names of the boolean RankingFlags that are TRUE for this user. */
  userRankingFlags: string[];
  /** Coarse anonymized region label. */
  userRegionLabel?: string;
}

/**
 * One upcoming-hearing entry supplied to the
 * `committee-relevance-explanation` prompt. The LLM may cite the date + topic
 * verbatim as a time-sensitive anchor.
 */
export interface CommitteeUpcomingHearing {
  /** Hearing date in YYYY-MM-DD format. */
  date: string;
  /** One-line topic / agenda summary. */
  topic: string;
}

/**
 * Params for the `committee-relevance-explanation` prompt — extends the
 * `relevanceReason` contract to legislative committees (opuspopuli#836).
 * Cross-repo contract mirrors `CommitteeRelevanceExplanationDto`
 * (prompt-service#81).
 *
 * The strongest anchor when present is `membersOnUserSlate` — "your rep
 * serves on it" is a verifiable, jurisdiction-preserving claim. THE CALLER
 * is responsible for ensuring this list actually intersects with the user's
 * resolved rep slate; the prompt-service cannot validate the claim. If the
 * caller passes a rep who is NOT on the user's slate, the LLM will fabricate
 * a verifiable-sounding but wrong claim. See opuspopuli#836's acceptance
 * criteria + the DTO docblock in prompt-service#81.
 */
export interface CommitteeRelevanceExplanationParams {
  // ---------- Committee context ----------
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Display name (e.g. "Assembly Judiciary Committee"). */
  committeeName: string;
  /** Chamber + level the committee sits in. */
  jurisdiction:
    | "us_house"
    | "us_senate"
    | "state_assembly"
    | "state_senate"
    | "joint"
    | "state_other";
  /** Committee type. */
  committeeType?: "standing" | "select" | "joint" | "subcommittee";

  // ---------- Committee structured facts (anchor candidates) ----------
  /** 1-2 sentence plain-English description of the committee's jurisdiction. */
  mandateSummary: string;
  /** Controlled-vocab topics the committee covers (0-3). */
  topics: string[];
  /**
   * Intersection of committee members and the user's resolved rep slate.
   * Pass `[]` when empty. NEVER pass reps who aren't on the user's slate —
   * see the DTO docblock in prompt-service#81 and opuspopuli#836's
   * acceptance criteria. The contract is enforced by the CALLER.
   */
  membersOnUserSlate: string[];
  /** Controlled-vocab topic slugs from bills the committee acted on recently (0-3). */
  recentBillTopicsTouched: string[];
  /** Upcoming committee hearings the user could follow (0-3). */
  upcomingHearings: CommitteeUpcomingHearing[];

  // ---------- User anonymized profile ----------
  /** User's declared interest tags. */
  userInterestTags: string[];
  /** Names of the boolean RankingFlags that are TRUE for this user. */
  userRankingFlags: string[];
  /** Coarse anonymized region label. */
  userRegionLabel?: string;
}

/**
 * One entry in the region's lifecycle-stage taxonomy supplied to the
 * `bill-status-summary` prompt. Sourced from `civics_blocks.lifecycle_stages`
 * — the LLM picks one `id` from the list (or returns `"unknown"`) and the
 * caller writes that id verbatim to `bills.current_stage_id`. Per-region
 * taxonomy is the source of truth so a new region doesn't have to conform
 * to whatever the first region's stages happened to be (opuspopuli#823).
 */
export interface LifecycleStageInput {
  /** Stage id — must match a value stored in civics_blocks.lifecycle_stages. */
  id: string;
  /** Plain-language stage name shown to the LLM (e.g. "In Committee"). */
  name: string;
  /** One-sentence description of when this stage applies. */
  description: string;
}

/**
 * Params for the merged `bill-status-summary` prompt — single call that
 * returns (a) verbatim status + classified lifecycle stage + last-action +
 * `changed` flag, (b) plain-English summary tagged with controlled-vocab
 * topics/whoItAffects/fiscalImpact/stakeholderImpact, and (c) a
 * `{ skip: true }` sentinel for non-bills. Replaces two prior calls
 * (status portion of bill-extraction + bill-analysis) plus the
 * deterministic `resolveStageFromStatus()` pattern matcher which only
 * resolved 8% of CA bills. See OpusPopuli/opuspopuli#823.
 *
 * Variable shape MUST stay in lockstep with the prompt-service
 * `billStatusSummary` descriptor in `src/prompts/prompts.service.ts`.
 *
 * Output shape (returned by the LLM as the rendered prompt instructs):
 * ```
 * {
 *   status: {
 *     raw: string;                         // verbatim from page
 *     stage: string;                       // a stage.id from lifecycleStages or "unknown"
 *     lastActionDate: string | null;       // YYYY-MM-DD
 *     lastActionSnippet: string | null;
 *     changed: boolean;
 *   };
 *   summary: {
 *     plainEnglishSummary: string;
 *     topics: string[];                    // controlled vocab
 *     whoItAffects: string[];              // controlled vocab
 *     fiscalImpact: { level: 'none'|'low'|'medium'|'high'; summary: string };
 *     stakeholderImpact: string;
 *   };
 * } | { skip: true }
 * ```
 */
export interface BillStatusSummaryParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** Bill display number (e.g. "AB 1", "SB 500"). */
  billNumber: string;
  /** Legislative session, e.g. "2025-2026". */
  sessionYear: string;
  /** Full official bill title. */
  title: string;
  /** Raw HTML of the bill detail page — status + body content for summarization. */
  html: string;
  /**
   * Region-specific lifecycle stage taxonomy from civics_blocks.lifecycle_stages.
   * The LLM picks one stage.id from this list (or "unknown"). MUST contain at
   * least one entry — the call is meaningless without a taxonomy to classify into.
   */
  lifecycleStages: LifecycleStageInput[];
  /**
   * Prior known status verbatim (current bills.status). Drives the LLM's
   * `status.changed` decision. Omit on first ingest.
   */
  priorStatus?: string;
  /**
   * Prior known stage id (current bills.current_stage_id). Lets the LLM
   * detect stage transitions even when status text is unchanged.
   */
  priorStage?: string;
}

/**
 * Params for the `briefing-summary` prompt (opuspopuli#849 Phase 2).
 * The LLM produces a 2-3 sentence opening paragraph (30-60 words) for
 * the user's `/me/briefing` page — the warm narrative companion to
 * the deterministic Phase 1 greeting/summary template that the
 * frontend always renders as fallback.
 *
 * MUST stay descriptive ("here's what's open"), NEVER persuasive
 * ("you should read"). The prompt-service template's HARD CONSTRAINTS
 * block forbids the §10 commitment-4 vocabulary; the opuspopuli-side
 * validator independently scans LLM output and silently falls back
 * to the Phase 1 template on any match.
 *
 * Privacy boundary: this endpoint receives ONLY non-sensitive
 * anonymized context — first name (T1, user-provided), aggregate
 * counts of cards already on the briefing, and the top bill's axis
 * label. NEVER T3 traits, raw addresses, behavioral event rows, or
 * UserSession timestamps. Same anonymization rule as bill-relevance-
 * explanation (planning doc §6.3 + §10 commitment 7).
 */
export interface BriefingSummaryParams {
  /** Output language. Must match the user's UI language. */
  language: "en" | "es";
  /**
   * User's first name (T1, user-provided). Pass null/undefined to
   * use the no-name register: the LLM addresses the user as
   * `neighbor` in EN, or drops the address word entirely in ES.
   */
  firstName?: string | null;
  /** Number of bills the user will see on the briefing. */
  billCount: number;
  /** Number of representatives. */
  repCount: number;
  /** Number of committees. */
  committeeCount: number;
  /** Number of propositions. */
  propositionCount: number;
  /**
   * How many of the user's top-ranked bills have an actionability
   * axis score >= 0.5 — i.e. a vote, hearing, or comment window
   * within ~30 days. Drives the urgency beat in the paragraph.
   */
  urgentBillCount: number;
  /**
   * Top-ranking axis on the highest-scoring bill — lets the LLM
   * frame the stake of the top match. null when no bills exist.
   */
  topBillTopAxis?:
    | "directMaterial"
    | "valuesAlignment"
    | "actionability"
    | null;
}

export const PROMPT_CLIENT_CONFIG = "PROMPT_CLIENT_CONFIG";

export type { PromptServiceResponse };
