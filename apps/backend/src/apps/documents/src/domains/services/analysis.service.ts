import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import { MetricsService } from 'src/common/metrics';
import { DocumentAnalysis, AnalyzeDocumentResult } from '../dto/analysis.dto';
import { parseAnalysisResponse } from '../prompts/document-analysis.prompt';
import { LinkingService } from './linking.service';

/**
 * Closed skip-reason vocabulary of the non-petition gate (#1057). Never a
 * free-text field: a bogus scan can be someone's personal letter, and a
 * reason that echoed document text would leak it into logs and the shared
 * analysis cache. Cross-repo contract with prompt-service's
 * document-analysis-petition v2 template (prompt-service#107).
 */
type SkipReason = 'not_a_petition' | 'unreadable';

/**
 * Below this much extracted text there is nothing any analysis could
 * defensibly say — skip the LLM call entirely and return the "unreadable"
 * verdict (which invites a rescan). Deliberately tiny: a real petition
 * sheet OCRs to hundreds of characters even from a bad photo, and a false
 * "unreadable" on a genuine petition is the failure mode we must avoid
 * (launch 2026-08-27). Petition scans only.
 */
const MIN_ANALYZABLE_TEXT_CHARS = 80;

/**
 * Analysis Service
 *
 * Handles LLM-based document analysis with type-specific prompts.
 * Results are cached by contentHash + document type.
 * Auto-matches related measures to propositions after analysis.
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
    private readonly promptClient: PromptClientService,
    private readonly metricsService: MetricsService,
    private readonly linkingService: LinkingService,
  ) {}

  /**
   * Analyze a document using LLM with type-specific prompts
   * Results are cached by contentHash + document type
   */
  async analyzeDocument(
    userId: string,
    documentId: string,
    forceReanalyze = false,
  ): Promise<AnalyzeDocumentResult> {
    const startTime = Date.now();

    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (!document.extractedText) {
      throw new BadRequestException(
        'Document text not extracted. Extract text first.',
      );
    }

    // Check cache by contentHash (same content + type = same analysis)
    if (!forceReanalyze && document.contentHash) {
      const cached = await this.db.document.findFirst({
        where: {
          contentHash: document.contentHash,
          type: document.type,
          analysis: { not: Prisma.DbNull },
        },
        select: { id: true, analysis: true },
      });

      if (cached?.analysis) {
        this.logger.log(
          `Cache hit for document ${documentId} (matched ${cached.id})`,
        );
        this.metricsService.recordAnalysisCacheHit('documents-service');
        return {
          analysis: {
            ...(cached.analysis as object),
            cachedFrom: cached.id,
          } as DocumentAnalysis,
          fromCache: true,
        };
      }
    }

    // Update status to in-progress
    await this.db.document.update({
      where: { id: documentId },
      data: { status: 'ai_analysis_started' },
    });

    try {
      // Minimum-text pre-gate (#1057, petition scans only): don't pay for
      // an LLM call that cannot defensibly say anything. Inside the try so
      // a persistence failure flows through the same ai_analysis_failed
      // path as every other failure; after the cache check so a cached
      // verdict for the same content still short-circuits.
      if (
        document.type === 'petition' &&
        document.extractedText.trim().length < MIN_ANALYZABLE_TEXT_CHARS
      ) {
        return await this.persistSkipVerdict(
          documentId,
          document.type,
          'unreadable',
          {
            provider: 'documents-service',
            model: 'min-text-gate',
            processingTimeMs: Date.now() - startTime,
          },
        );
      }

      const { promptText, promptHash, promptVersion } =
        await this.promptClient.getDocumentAnalysisPrompt({
          documentType: document.type,
          text: document.extractedText,
        });
      const result = await this.llm.generate(promptText, {
        maxTokens: 1500,
        temperature: 0.3,
      });

      const parsed = parseAnalysisResponse(result.text);
      const processingTimeMs = Date.now() - startTime;
      const now = new Date().toISOString();

      // Classification sentinel (#1057): the petition template's first job
      // is deciding whether this IS a petition. The verdict is persisted
      // like any analysis — cached by (contentHash, type), recoverable via
      // forceReanalyze — but carries no fabricated analysis fields.
      // Truthy check on purpose: a model emitting "true"/1 instead of true
      // must not fall through to the full-analysis path, where a
      // summary-less object would be persisted AND cached, hard-erroring
      // the non-nullable GraphQL summary field for everyone with the same
      // contentHash.
      if (document.type === 'petition' && Boolean(parsed.skip)) {
        return this.persistSkipVerdict(
          documentId,
          document.type,
          parsed.reason === 'unreadable' ? 'unreadable' : 'not_a_petition',
          {
            provider: this.llm.getName(),
            model: this.llm.getModelName(),
            promptVersion,
            promptHash,
            tokensUsed: result.tokensUsed,
            processingTimeMs,
          },
        );
      }

      // Build source provenance (#423)
      const sources = this.buildAnalysisSources(document.type, now, parsed);

      // Calculate data completeness (#425)
      const { completenessScore, completenessDetails } =
        this.calculateCompleteness(document.type, parsed);

      // Never let model-supplied skip/reason keys leak into a persisted
      // full analysis — `reason` is free text from the model on this path.
      delete parsed.skip;
      delete parsed.reason;

      const analysis = {
        ...parsed,
        // Explicit positive verdict for petition scans; absent on other
        // document types and on pre-#1057 cached analyses (both treated
        // as petition-equivalent by consumers for compatibility).
        ...(document.type === 'petition' && { isPetition: true }),
        documentType: document.type,
        analyzedAt: now,
        provider: this.llm.getName(),
        model: this.llm.getModelName(),
        tokensUsed: result.tokensUsed,
        processingTimeMs,
        promptVersion,
        promptHash,
        sources,
        completenessScore,
        completenessDetails,
      };

      await this.db.document.update({
        where: { id: documentId },
        data: {
          analysis: analysis as Prisma.InputJsonValue,
          status: 'ai_analysis_complete',
        },
      });

      this.logger.log(
        `Analyzed document ${documentId} (${document.type}) in ${processingTimeMs}ms`,
      );

      this.metricsService.recordAnalysisCacheMiss('documents-service');
      this.metricsService.recordAnalysis(
        'documents-service',
        document.type,
        'success',
        processingTimeMs / 1000,
      );

      // Auto-match relatedMeasures to propositions for petition documents
      if (
        document.type === 'petition' &&
        parsed.relatedMeasures &&
        Array.isArray(parsed.relatedMeasures) &&
        (parsed.relatedMeasures as string[]).length > 0
      ) {
        this.linkingService.matchAndLinkPropositionsSafely(
          documentId,
          parsed.relatedMeasures as string[],
        );
      }

      return {
        analysis: analysis as unknown as DocumentAnalysis,
        fromCache: false,
      };
    } catch (error) {
      this.logger.error(`Analysis failed for document ${documentId}:`, error);
      await this.db.document.update({
        where: { id: documentId },
        data: { status: 'ai_analysis_failed' },
      });
      this.metricsService.recordAnalysisCacheMiss('documents-service');
      this.metricsService.recordAnalysis(
        'documents-service',
        document.type,
        'failure',
        (Date.now() - startTime) / 1000,
      );
      throw error;
    }
  }

  /**
   * Persist a non-petition verdict (#1057) in place of an analysis.
   *
   * Shaped like an analysis on purpose: it lives in the same Json column,
   * rides the same (contentHash, type) cache — the same menu scanned by
   * anyone resolves instantly without an LLM call — and is replaced by a
   * normal re-run via forceReanalyze if the classifier got it wrong. The
   * required analysis fields are empty, never fabricated; skipReason is
   * the closed enum only, so nothing from the document text can leak.
   */
  private async persistSkipVerdict(
    documentId: string,
    documentType: string,
    skipReason: SkipReason,
    provenance: {
      provider: string;
      model: string;
      promptVersion?: string;
      promptHash?: string;
      tokensUsed?: number;
      processingTimeMs: number;
    },
  ): Promise<AnalyzeDocumentResult> {
    const verdict = {
      isPetition: false,
      skipReason,
      documentType,
      summary: '',
      keyPoints: [],
      entities: [],
      analyzedAt: new Date().toISOString(),
      ...provenance,
    };

    await this.db.document.update({
      where: { id: documentId },
      data: {
        analysis: verdict as Prisma.InputJsonValue,
        status: 'ai_analysis_complete',
      },
    });

    this.logger.log(
      `Non-petition verdict for document ${documentId}: ${skipReason} (${provenance.model})`,
    );
    this.metricsService.recordAnalysisCacheMiss('documents-service');
    this.metricsService.recordAnalysis(
      'documents-service',
      documentType,
      `skipped_${skipReason}`,
      provenance.processingTimeMs / 1000,
    );

    return {
      analysis: verdict as unknown as DocumentAnalysis,
      fromCache: false,
    };
  }

  /**
   * Get existing analysis for a document
   */
  async getDocumentAnalysis(
    userId: string,
    documentId: string,
  ): Promise<DocumentAnalysis | null> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
      select: { analysis: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return (document.analysis as unknown as DocumentAnalysis) || null;
  }

  /**
   * Build source provenance for an analysis (#423)
   * Describes what data sources contributed to the analysis.
   */
  private buildAnalysisSources(
    documentType: string,
    accessedAt: string,
    parsed: Record<string, unknown>,
  ) {
    const sources = [
      {
        name: 'Scanned Document (OCR)',
        accessedAt,
        dataCompleteness: 100,
      },
      {
        name: `${this.llm.getName()} LLM Analysis (${this.llm.getModelName()})`,
        accessedAt,
        dataCompleteness: 100,
      },
    ];

    // Check if entity data was returned
    const entities = parsed.entities as string[] | undefined;
    if (entities && entities.length > 0) {
      sources.push({
        name: 'Entity Extraction',
        accessedAt,
        dataCompleteness: 100,
      });
    }

    // Related measures are a key provenance signal for petitions
    const relatedMeasures = parsed.relatedMeasures as string[] | undefined;
    if (
      documentType === 'petition' &&
      relatedMeasures &&
      relatedMeasures.length > 0
    ) {
      sources.push({
        name: 'Related Measures Database',
        accessedAt,
        dataCompleteness: 60, // LLM knowledge, not live DB lookup
      });
    }

    return sources;
  }

  /**
   * Ideal data source expectations per document type (#425)
   */
  private static readonly IDEAL_SOURCES: Record<string, string[]> = {
    petition: [
      'Document text content',
      'Entity data',
      'Related measures',
      'Financial impact data',
      'Legal analysis',
    ],
    contract: [
      'Document text content',
      'Entity data',
      'Party obligations',
      'Risk assessment',
      'Termination clauses',
    ],
    form: [
      'Document text content',
      'Required fields',
      'Submission requirements',
    ],
  };

  /**
   * Calculate data completeness for analysis results (#425)
   */
  private calculateCompleteness(
    documentType: string,
    parsed: Record<string, unknown>,
  ): {
    completenessScore: number;
    completenessDetails: {
      availableCount: number;
      idealCount: number;
      missingItems: string[];
      explanation: string;
    };
  } {
    const idealSources =
      AnalysisService.IDEAL_SOURCES[documentType] ??
      AnalysisService.IDEAL_SOURCES['petition'];

    const available: string[] = [];
    const missing: string[] = [];

    // Check what data we actually have
    const checks: [string, unknown][] = [
      ['Document text content', true], // Always present if we got here
      ['Entity data', (parsed.entities as string[] | undefined)?.length],
      [
        'Related measures',
        (parsed.relatedMeasures as string[] | undefined)?.length,
      ],
      ['Financial impact data', null], // Not yet available
      ['Legal analysis', parsed.actualEffect],
      [
        'Party obligations',
        (parsed.obligations as string[] | undefined)?.length,
      ],
      ['Risk assessment', (parsed.risks as string[] | undefined)?.length],
      ['Termination clauses', parsed.terminationClause],
      [
        'Required fields',
        (parsed.requiredFields as string[] | undefined)?.length,
      ],
      ['Submission requirements', parsed.submissionDeadline],
    ];

    for (const idealItem of idealSources) {
      const check = checks.find(([name]) => name === idealItem);
      if (check?.[1]) {
        available.push(idealItem);
      } else {
        missing.push(idealItem);
      }
    }

    const idealCount = idealSources.length;
    const availableCount = available.length;
    const score =
      idealCount > 0 ? Math.round((availableCount / idealCount) * 100) : 100;

    const explanation =
      availableCount === idealCount
        ? 'All expected data sources are available for this analysis.'
        : `This analysis is based on ${availableCount} of ${idealCount} available data sources for this document type.`;

    return {
      completenessScore: score,
      completenessDetails: {
        availableCount,
        idealCount,
        missingItems: missing,
        explanation,
      },
    };
  }
}
