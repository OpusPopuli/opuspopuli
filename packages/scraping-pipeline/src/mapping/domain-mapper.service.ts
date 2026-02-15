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
    const result = PropositionSchema.safeParse(record);
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
    const enriched = {
      ...record,
      body: record.body ?? category ?? "Unknown",
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

const PropositionSchema = z
  .object({
    externalId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().default(""),
    fullText: z.string().optional(),
    status: z.nativeEnum(PropositionStatus).default(PropositionStatus.PENDING),
    electionDate: z.coerce.date().optional(),
    sourceUrl: z.string().url().optional(),
  })
  .transform((data) => ({
    ...data,
    summary: data.summary || data.title,
  }));

const MeetingSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default("Unknown"),
  scheduledAt: z.coerce.date(),
  location: z.string().optional(),
  agendaUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
});

const RepresentativeSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  chamber: z.string().default("Unknown"),
  district: z.string().default("Unknown"),
  party: z.string().default("Unknown"),
  photoUrl: z.string().optional(),
  contactInfo: z
    .object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
    })
    .optional(),
});

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

const ContributionSchema = z.object({
  externalId: z.string().min(1),
  committeeId: z.string().min(1),
  donorName: z.string().min(1),
  donorType: z.string().transform(donorTypeTransform).default("other"),
  donorEmployer: z.string().optional(),
  donorOccupation: z.string().optional(),
  donorCity: z.string().optional(),
  donorState: z.string().optional(),
  donorZip: z.string().optional(),
  amount: z.coerce.number(),
  date: z.coerce.date(),
  electionType: z.string().optional(),
  contributionType: z.string().optional(),
  sourceSystem: z.enum(["cal_access", "fec"]),
});

const ExpenditureSchema = z.object({
  externalId: z.string().min(1),
  committeeId: z.string().min(1),
  payeeName: z.string().min(1),
  amount: z.coerce.number(),
  date: z.coerce.date(),
  purposeDescription: z.string().optional(),
  expenditureCode: z.string().optional(),
  candidateName: z.string().optional(),
  propositionTitle: z.string().optional(),
  supportOrOppose: z.string().transform(supportOpposeTransform).optional(),
  sourceSystem: z.enum(["cal_access", "fec"]),
});

const IndependentExpenditureSchema = z.object({
  externalId: z.string().min(1),
  committeeId: z.string().min(1),
  committeeName: z.string().min(1),
  candidateName: z.string().optional(),
  propositionTitle: z.string().optional(),
  supportOrOppose: z
    .string()
    .transform((val) => supportOpposeTransform(val) ?? "support")
    .default("support"),
  amount: z.coerce.number(),
  date: z.coerce.date(),
  electionDate: z.coerce.date().optional(),
  description: z.string().optional(),
  sourceSystem: z.enum(["cal_access", "fec"]),
});
