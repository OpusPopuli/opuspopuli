/**
 * Domain Mapper Service
 *
 * Maps raw extracted records to typed domain models
 * (Proposition, Meeting, Representative).
 * Validates with Zod schemas and handles type coercion.
 */

import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  DataType,
  PropositionStatus,
  CommitteeType,
  type Proposition,
  type Meeting,
  type Representative,
  type Committee,
  type Contribution,
  type Expenditure,
  type IndependentExpenditure,
  type RawExtractionResult,
  type ExtractionResult,
  type DataSourceConfig,
} from "@opuspopuli/common";

@Injectable()
export class DomainMapperService {
  private readonly logger = new Logger(DomainMapperService.name);

  /**
   * Map raw extraction results to typed civic data.
   *
   * @param raw - Raw extraction result
   * @param source - Data source config (for category/context)
   * @returns Typed extraction result
   */
  map<T>(
    raw: RawExtractionResult,
    source: DataSourceConfig,
  ): ExtractionResult<T> {
    const startTime = Date.now();
    const warnings = [...raw.warnings];
    const errors = [...raw.errors];
    const items: T[] = [];

    for (let i = 0; i < raw.items.length; i++) {
      try {
        const mapped = this.mapItem(raw.items[i], source);
        if (mapped) {
          items.push(mapped as T);
        }
      } catch (error) {
        warnings.push(
          `Item ${i}: mapping failed — ${(error as Error).message}`,
        );
      }
    }

    return {
      items,
      manifestVersion: 0, // Set by pipeline orchestrator
      success: items.length > 0,
      warnings,
      errors,
      extractionTimeMs: Date.now() - startTime,
    };
  }

  private mapItem(
    record: Record<string, unknown>,
    source: DataSourceConfig,
  ):
    | Proposition
    | Meeting
    | Representative
    | Committee
    | Contribution
    | Expenditure
    | IndependentExpenditure
    | null {
    switch (source.dataType) {
      case DataType.PROPOSITIONS:
        return this.mapProposition(record);
      case DataType.MEETINGS:
        return this.mapMeeting(record, source.category);
      case DataType.REPRESENTATIVES:
        return this.mapRepresentative(record, source.category);
      case DataType.CAMPAIGN_FINANCE:
        return this.mapCampaignFinanceItem(record, source.category);
      default:
        return null;
    }
  }

  /**
   * Route campaign finance records to the correct sub-mapper based on category.
   */
  private mapCampaignFinanceItem(
    record: Record<string, unknown>,
    category?: string,
  ): Committee | Contribution | Expenditure | IndependentExpenditure | null {
    const cat = (category ?? "").toLowerCase();

    if (cat.includes("committee")) {
      return this.mapCommittee(record);
    } else if (cat.includes("independent") || cat.includes("s496")) {
      return this.mapIndependentExpenditure(record);
    } else if (cat.includes("expenditure")) {
      return this.mapExpenditure(record);
    } else if (cat.includes("contribution")) {
      return this.mapContribution(record);
    }

    // Default: try contribution (most common campaign finance record type)
    return this.mapContribution(record);
  }

  private mapProposition(record: Record<string, unknown>): Proposition | null {
    // The CA SOS qualified-ballot-measures page emits each measure as an
    // anchor whose href points to the bill PDF. The regions config
    // extracts that href as `detailUrl`, but the proposition domain
    // type stores it as `sourceUrl`. Map across so the field lands.
    const enriched = {
      ...record,
      sourceUrl: record.sourceUrl ?? record.detailUrl,
    };
    const result = PropositionSchema.safeParse(enriched);
    if (!result.success) {
      this.logger.debug(
        `Proposition validation failed: ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  }

  private mapMeeting(
    record: Record<string, unknown>,
    category?: string,
  ): Meeting | null {
    // Inject body from category if not in record
    // Generate externalId from title+scheduledAt if missing (AI sometimes can't find one)
    const enriched = {
      ...record,
      body: record.body ?? category ?? "Unknown",
      externalId:
        record.externalId ??
        `${category ?? "meeting"}-${typeof record.title === "string" ? record.title.slice(0, 30) : ""}-${typeof record.scheduledAt === "string" ? record.scheduledAt : ""}`
          .replaceAll(/\s+/g, "-")
          .toLowerCase(),
    };

    const result = MeetingSchema.safeParse(enriched);
    if (!result.success) {
      this.logger.debug(`Meeting validation failed: ${result.error.message}`);
      return null;
    }
    return result.data;
  }

  private mapRepresentative(
    record: Record<string, unknown>,
    category?: string,
  ): Representative | null {
    // Inject chamber from category if not in record
    const enriched = {
      ...record,
      chamber: record.chamber ?? category ?? "Unknown",
    };

    const result = RepresentativeSchema.safeParse(enriched);
    if (!result.success) {
      this.logger.debug(
        `Representative validation failed: ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  }

  private mapCommittee(record: Record<string, unknown>): Committee | null {
    const result = CommitteeSchema.safeParse(record);
    if (!result.success) {
      this.logger.debug(`Committee validation failed: ${result.error.message}`);
      return null;
    }
    return result.data;
  }

  private mapContribution(
    record: Record<string, unknown>,
  ): Contribution | null {
    // Combine first/last name fields if donorName not already set
    const enriched = { ...record };
    if (
      !enriched.donorName &&
      (enriched.donorLastName || enriched.donorFirstName)
    ) {
      const last = (enriched.donorLastName as string) ?? "";
      const first = (enriched.donorFirstName as string) ?? "";
      enriched.donorName = first ? `${last}, ${first}`.trim() : last;
    }

    const result = ContributionSchema.safeParse(enriched);
    if (!result.success) {
      this.logger.debug(
        `Contribution validation failed: ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  }

  private mapExpenditure(record: Record<string, unknown>): Expenditure | null {
    const result = ExpenditureSchema.safeParse(record);
    if (!result.success) {
      this.logger.debug(
        `Expenditure validation failed: ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  }

  private mapIndependentExpenditure(
    record: Record<string, unknown>,
  ): IndependentExpenditure | null {
    const result = IndependentExpenditureSchema.safeParse(record);
    if (!result.success) {
      this.logger.debug(
        `IndependentExpenditure validation failed: ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  }
}

// ============================================
// Zod Schemas for Domain Models
// ============================================

/**
 * Parse dates from multiple formats, accepting null/undefined.
 * Returns Date or undefined (never throws on null).
 */
function parseFlexibleDate(val: unknown): Date | undefined {
  if (val === null || val === undefined) return undefined;
  if (val instanceof Date) return val;
  const str = String(val).trim();
  if (!str) return undefined;

  // Try standard ISO date parsing first (2025-01-15, 2025-01-15T00:00:00Z)
  const standard = new Date(str);
  if (!Number.isNaN(standard.getTime()) && str.length > 8) return standard;

  // 8-digit formats: try MMDDYYYY first (CAL-ACCESS), then YYYYMMDD (FEC)
  if (/^\d{8}$/.test(str)) {
    const mm = str.slice(0, 2);
    const dd = str.slice(2, 4);
    const yyyy = str.slice(4, 8);
    const calAccess = new Date(`${yyyy}-${mm}-${dd}`);
    if (!Number.isNaN(calAccess.getTime()) && Number(mm) <= 12)
      return calAccess;

    const fecYyyy = str.slice(0, 4);
    const fecMm = str.slice(4, 6);
    const fecDd = str.slice(6, 8);
    const fec = new Date(`${fecYyyy}-${fecMm}-${fecDd}`);
    if (!Number.isNaN(fec.getTime())) return fec;
  }

  // US format: MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [mm, dd, yyyy] = str.split("/");
    const parsed = new Date(
      `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`,
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}

/** Zod schema for required date fields (rejects null/empty) */
const coerceFlexibleDate = z
  .unknown()
  .transform(parseFlexibleDate)
  .pipe(z.date({ message: "Invalid date format" }));

/** Zod schema for optional date fields (null/empty → undefined) */
const coerceFlexibleDateOptional = z
  .unknown()
  .transform(parseFlexibleDate)
  .pipe(z.date().optional());

/**
 * Clean a CA SOS qualified-ballot-measures anchor text down to the bare
 * descriptive title.
 *
 * The SOS page emits each measure as one anchor of the form:
 *
 *   `ACA 13 (Ward) Voting thresholds. (Res. Ch. 176, 2023) (PDF)`
 *
 * which has four glued-on parts beyond the actual title:
 *  1. The leading `<MEASURE_ID>` (already extracted as externalId).
 *  2. The author parenthetical `(Ward)`.
 *  3. A trailing chapter-info parenthetical `(Res. Ch. 176, 2023)`.
 *  4. A `(PDF)` document-format suffix.
 *
 * Region-config hint #29 in `california.json` deliberately captures the
 * full anchor text and leaves cleanup to the consumer ("title: ... .
 * Cleanup is the consumer's job; do NOT add a transform"). A previous
 * attempt to push cleanup into a regex_replace transform broke the
 * pipeline (the manifest fanned out into mismatched groups). This is
 * the consumer side of that contract.
 *
 * Examples:
 *   `"ACA 13 (Ward) Voting thresholds. (Res. Ch. 176, 2023) (PDF)"`
 *     → `"Voting thresholds"`
 *   `"SB 42 (Umberg) Political Reform Act of 1974: public campaign financing. (Ch. 245, 2025) (PDF)"`
 *     → `"Political Reform Act of 1974: public campaign financing"`
 *   `"SCA 1 (Newman) Elections: recall of state officers. (Res. Ch. 204, 2024) (PDF)"`
 *     → `"Elections: recall of state officers"`
 *
 * If the input doesn't match the expected shape (e.g. titles already
 * cleaned upstream, or a future SOS layout change), returns the input
 * trimmed — never empty.
 */
export function cleanPropositionTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Strip leading "<MEASURE_ID> (<author>) ". The character classes are
  // disjoint (`[A-Z]`, `\s`, `\d`, `[^)]`), each quantifier operates on
  // a non-overlapping set, and the pattern is anchored at `^` — no
  // ambiguous match positions, so backtracking stays linear in input
  // length even if the regex doesn't match.
  let cleaned = trimmed.replace(/^[A-Z]+\s*\d+\s*\([^)]*\)\s*/, "");

  // Strip trailing parentheticals one at a time via a single-match regex
  // per iteration. The original `(?:\([^)]*\)\s*)+$` form was flagged by
  // Sonar's ReDoS heuristic for nested quantifiers (`+` outer + `*`
  // inside) — even though the inner content classes are disjoint and
  // can't actually backtrack super-linearly, the loop form is provably
  // O(n) per iteration with at most O(n) iterations (each strip removes
  // at least 2 chars: `()`), keeping worst-case total at O(n²) without
  // any backtracking ambiguity for the static analyzer to flag.
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, "");
  } while (cleaned !== prev);

  // Strip a single trailing period that was the original end-of-title
  // punctuation in the SOS anchor.
  cleaned = cleaned.replace(/\.\s*$/, "");

  cleaned = cleaned.trim();

  // Defensive: if cleanup produced an empty string (the input was just
  // a measure id + parentheticals with no descriptor), fall back to
  // the trimmed input so the downstream `min(1)` validator doesn't
  // reject the row.
  return cleaned || trimmed;
}

const PropositionSchema = z
  .object({
    externalId: z.string().min(1),
    title: z.string().min(1).transform(cleanPropositionTitle),
    summary: z.string().default(""),
    fullText: z.string().optional(),
    status: z.nativeEnum(PropositionStatus).default(PropositionStatus.PENDING),
    electionDate: coerceFlexibleDateOptional,
    sourceUrl: z
      .string()
      .url()
      .nullable()
      .transform((v) => v ?? undefined)
      .optional(),
  })
  .transform((data) => ({
    ...data,
    summary: data.summary || data.title,
  }));

const MeetingSchema = z.object({
  externalId: z.string().min(1),
  title: z
    .string()
    .nullable()
    .transform((v) => v ?? "Untitled Meeting")
    .default("Untitled Meeting"),
  body: z.string().default("Unknown"),
  scheduledAt: z.coerce.date(),
  location: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  agendaUrl: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  videoUrl: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  minutes: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
});

const partyTransform = (val: string | undefined) => {
  if (!val) return "Unknown";
  const cleaned = val.toUpperCase().replace(/[()]/g, "").trim();
  if (cleaned === "D" || cleaned === "DEMOCRAT" || cleaned === "DEMOCRATIC")
    return "Democratic";
  if (cleaned === "R" || cleaned === "REPUBLICAN") return "Republican";
  if (cleaned === "I" || cleaned === "INDEPENDENT") return "Independent";
  return val;
};

/**
 * Canonicalize a representative's externalId to a stable form:
 *   ca-{chamber}-{district-digits}
 *
 * The scraping pipeline produces externalId from whatever the manifest
 * extracts — typically a URL path like "/assemblymembers/22" or an
 * absolute URL like "https://www.assembly.ca.gov/assemblymembers/22".
 * These forms drift across Cheerio/scraper versions, so storing the raw
 * value means the same rep gets upserted under different IDs → duplicate
 * rows. This transform extracts the numeric district portion and builds
 * a canonical ID that's stable regardless of scrape output format.
 */
function canonicalizeRepresentativeId(
  rawId: string,
  chamber: string | undefined,
): string {
  // If the ID already looks canonical (e.g. "ca-assembly-22"), keep it.
  if (/^ca-(assembly|senate)-\d+$/i.test(rawId)) {
    return rawId.toLowerCase();
  }
  // Find all digit runs and take the last one. Linear time; avoids the
  // negative-lookahead pattern (e.g. /(\d+)(?!.*\d)/) which is super-linear
  // due to backtracking and flagged by static analysis as a ReDoS risk.
  const digits = rawId.match(/\d+/g)?.at(-1);
  if (!digits) return rawId; // fall back to raw — validation will flag it
  const normalizedChamber = (chamber ?? "unknown").trim().toLowerCase();
  return `ca-${normalizedChamber}-${digits}`;
}

const RepresentativeSchema = z
  .object({
    externalId: z.string().min(1),
    name: z.string().min(1),
    chamber: z.string().default("Unknown"),
    district: z.string().default("Unknown"),
    party: z.string().transform(partyTransform).default("Unknown"),
    photoUrl: z.string().optional(),
    contactInfo: z
      .object({
        email: z.string().email().optional(),
        website: z.string().optional(),
        offices: z
          .array(
            z.object({
              name: z.string(),
              address: z.string().optional(),
              phone: z.string().optional(),
              fax: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    committees: z
      .array(
        z.object({
          name: z.string(),
          role: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .optional(),
    bio: z.string().optional(),
  })
  .transform((rep) => ({
    ...rep,
    externalId: canonicalizeRepresentativeId(rep.externalId, rep.chamber),
  }));

// ============================================
// Zod Schemas for Campaign Finance Models
// ============================================

const supportOpposeTransform = (val: string | undefined) => {
  if (!val) return undefined;
  const upper = val.toUpperCase();
  if (upper === "S" || upper === "SUPPORT") return "support" as const;
  if (upper === "O" || upper === "OPPOSE") return "oppose" as const;
  return undefined;
};

const donorTypeTransform = (val: string | undefined) => {
  if (!val) return "other" as const;
  const upper = val.toUpperCase();
  if (upper === "IND") return "individual" as const;
  if (upper === "COM") return "committee" as const;
  if (upper === "PTY") return "party" as const;
  if (upper === "SCC") return "individual" as const; // small contributor → individual
  if (upper === "OTH") return "other" as const;
  return "other" as const;
};

const CommitteeSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  type: z.nativeEnum(CommitteeType).default(CommitteeType.OTHER),
  candidateName: z.string().optional(),
  candidateOffice: z.string().optional(),
  propositionId: z.string().optional(),
  party: z.string().optional(),
  status: z.enum(["active", "terminated"]).default("active"),
  sourceSystem: z.enum(["cal_access", "fec"]),
  sourceUrl: z.string().optional(),
});

/**
 * Parse dates from multiple formats:
 * - ISO: 2025-01-15
 * - US: 01/15/2025
 * - CAL-ACCESS: 01152025 (MMDDYYYY, no delimiters)
 * - FEC: 20250115 (YYYYMMDD)
 */
const ContributionSchema = z.object({
  externalId: z.string().min(1),
  committeeId: z.string().min(1),
  donorName: z.string().min(1),
  donorType: z.string().transform(donorTypeTransform).default("other"),
  donorEmployer: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  donorOccupation: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  donorCity: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  donorState: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  donorZip: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  amount: z.coerce.number(),
  date: coerceFlexibleDate,
  electionType: z.string().optional(),
  contributionType: z.string().optional(),
  sourceSystem: z.enum(["cal_access", "fec"]),
});

const ExpenditureSchema = z
  .object({
    externalId: z.string().min(1),
    committeeId: z.string().min(1),
    payeeName: z.string().min(1),
    amount: z.coerce.number(),
    date: coerceFlexibleDate,
    purposeDescription: z
      .string()
      .nullable()
      .transform((v) => v ?? undefined)
      .optional(),
    expenditureCode: z
      .string()
      .nullable()
      .transform((v) => v ?? undefined)
      .optional(),
    candidateName: z
      .string()
      .nullable()
      .transform((v) => v ?? undefined)
      .optional(),
    propositionTitle: z
      .string()
      .nullable()
      .transform((v) => v ?? undefined)
      .optional(),
    // Transient gating field — extracted from CalAccess BAL_NUM, used to
    // decide whether `propositionTitle` is real or filer noise (#633),
    // then dropped from the output below. The DB has no `ballotNumber`
    // column on Expenditure; don't add one without a separate plan.
    ballotNumber: z
      .string()
      .nullable()
      .transform((v) => (v ? v.trim() : undefined))
      .optional(),
    supportOrOppose: z
      .string()
      .nullable()
      .optional()
      .transform((val) => (val ? supportOpposeTransform(val) : undefined)),
    sourceSystem: z.enum(["cal_access", "fec"]),
  })
  // Drop `propositionTitle` when the row carries no `BAL_NUM`. CalAccess
  // filers misuse the BAL_NAME field to stuff committee names, party
  // names, city names, etc. on non-ballot-measure expenditures; real
  // ballot-measure rows always carry both. This is the same gate the
  // proposition-finance-linker already applies to CVR2 rows ("ballotName/
  // ballotNumber being non-empty"). Strip `ballotNumber` itself so it
  // doesn't leak into downstream consumers expecting the persisted shape.
  .transform(({ ballotNumber, ...rest }) => ({
    ...rest,
    propositionTitle: ballotNumber ? rest.propositionTitle : undefined,
  }));

const IndependentExpenditureSchema = z.object({
  externalId: z.string().min(1),
  committeeId: z.string().min(1),
  committeeName: z
    .string()
    .nullable()
    .transform((v) => v ?? "Unknown")
    .default("Unknown"),
  candidateName: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  propositionTitle: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  supportOrOppose: z
    .string()
    .nullable()
    .optional()
    .transform((val) => (val ? supportOpposeTransform(val) : "support"))
    .default("support"),
  amount: z.coerce.number(),
  date: coerceFlexibleDate,
  electionDate: coerceFlexibleDateOptional,
  description: z
    .string()
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  sourceSystem: z.enum(["cal_access", "fec"]),
});
