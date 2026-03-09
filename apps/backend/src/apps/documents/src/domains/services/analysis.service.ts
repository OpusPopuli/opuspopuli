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

      // Build source provenance (#423)
      const sources = this.buildAnalysisSources(document.type, now, parsed);

      // Calculate data completeness (#425)
      const { completenessScore, completenessDetails } =
        this.calculateCompleteness(document.type, parsed);

      const analysis = {
        ...parsed,
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
