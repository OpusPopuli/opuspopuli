/**
 * Domain Mapper Service
 *
 * Maps raw extracted records to typed civic data models
 * (Proposition, Meeting, Representative).
 * Validates with Zod schemas and handles type coercion.
 */

import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  CivicDataType,
  PropositionStatus,
  type Proposition,
  type Meeting,
  type Representative,
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
  ): Proposition | Meeting | Representative | null {
    switch (source.dataType) {
      case CivicDataType.PROPOSITIONS:
        return this.mapProposition(record);
      case CivicDataType.MEETINGS:
        return this.mapMeeting(record, source.category);
      case CivicDataType.REPRESENTATIVES:
        return this.mapRepresentative(record, source.category);
      default:
        return null;
    }
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
