import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService, LinkSource } from '@opuspopuli/relationaldb-provider';

import {
  LinkedProposition,
  LinkedPetitionDocument,
} from '../dto/document-proposition.dto';

/**
 * Linking Service
 *
 * Handles petition-to-ballot proposition linking.
 * Supports both automatic matching (after AI analysis)
 * and manual linking (user clicks "Track on Ballot").
 */
@Injectable()
export class LinkingService {
  private readonly logger = new Logger(LinkingService.name, {
    timestamp: true,
  });

  constructor(private readonly db: DbService) {}

  /**
   * Auto-match petition's relatedMeasures text to DB propositions.
   * Called after successful AI analysis for petition documents.
   * Uses case-insensitive substring matching against proposition titles/externalIds.
   */
  async matchAndLinkPropositions(
    documentId: string,
    relatedMeasures: string[],
  ): Promise<{ matched: number; propositionIds: string[] }> {
    if (relatedMeasures.length === 0) return { matched: 0, propositionIds: [] };

    const linkedIds: string[] = [];

    for (const measureText of relatedMeasures) {
      const normalized = measureText.trim();
      if (!normalized || normalized.toLowerCase() === 'none identified')
        continue;

      const match = await this.db.proposition.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { title: { contains: normalized, mode: 'insensitive' } },
            { externalId: { contains: normalized, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      if (match) {
        try {
          await this.db.documentProposition.upsert({
            where: {
              documentId_propositionId: {
                documentId,
                propositionId: match.id,
              },
            },
            update: {},
            create: {
              documentId,
              propositionId: match.id,
              linkSource: LinkSource.auto_analysis,
              confidence: 0.8,
              matchedText: measureText,
            },
          });
          linkedIds.push(match.id);
        } catch (error) {
          this.logger.warn(
            `Failed to link document ${documentId} to proposition ${match.id}: ${error}`,
          );
        }
      }
    }

    this.logger.log(
      `Auto-matched ${linkedIds.length}/${relatedMeasures.length} measures for document ${documentId}`,
    );
    return { matched: linkedIds.length, propositionIds: linkedIds };
  }

  /**
   * Safe wrapper for auto-matching (fire-and-forget after analysis).
   */
  async matchAndLinkPropositionsSafely(
    documentId: string,
    relatedMeasures: string[],
  ): Promise<void> {
    try {
      await this.matchAndLinkPropositions(documentId, relatedMeasures);
    } catch (err) {
      this.logger.warn(
        `Auto-match failed for ${documentId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Manually link a document to a proposition (user clicks "Track on Ballot").
   */
  async linkDocumentToProposition(
    userId: string,
    documentId: string,
    propositionId: string,
  ): Promise<{ success: boolean; linkId?: string }> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Document not found');

    const proposition = await this.db.proposition.findUnique({
      where: { id: propositionId },
    });
    if (!proposition) throw new NotFoundException('Proposition not found');

    const link = await this.db.documentProposition.upsert({
      where: {
        documentId_propositionId: { documentId, propositionId },
      },
      update: {},
      create: {
        documentId,
        propositionId,
        linkSource: LinkSource.user_manual,
      },
    });

    return { success: true, linkId: link.id };
  }

  /**
   * Unlink a document from a proposition.
   */
  async unlinkDocumentFromProposition(
    userId: string,
    documentId: string,
    propositionId: string,
  ): Promise<boolean> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Document not found');

    await this.db.documentProposition.deleteMany({
      where: { documentId, propositionId },
    });
    return true;
  }

  /**
   * Get propositions linked to a document.
   */
  async getLinkedPropositions(
    documentId: string,
  ): Promise<LinkedProposition[]> {
    const links = await this.db.documentProposition.findMany({
      where: { documentId },
      include: { proposition: true },
      orderBy: { createdAt: 'desc' },
    });

    return links.map((link) => ({
      id: link.id,
      propositionId: link.proposition.id,
      title: link.proposition.title,
      summary: link.proposition.summary,
      status: link.proposition.status,
      electionDate: link.proposition.electionDate ?? undefined,
      linkSource: link.linkSource,
      confidence: link.confidence ?? undefined,
      matchedText: link.matchedText ?? undefined,
      linkedAt: link.createdAt,
    }));
  }

  /**
   * Get petition documents linked to a proposition (for proposition detail page).
   */
  async getLinkedPetitionDocuments(
    propositionId: string,
  ): Promise<LinkedPetitionDocument[]> {
    const links = await this.db.documentProposition.findMany({
      where: { propositionId },
      include: { document: true },
      orderBy: { createdAt: 'desc' },
    });

    return links.map((link) => {
      const analysis = link.document.analysis as Record<string, unknown> | null;
      return {
        id: link.id,
        documentId: link.document.id,
        summary: (analysis?.summary as string) ?? 'Petition scan',
        linkSource: link.linkSource,
        confidence: link.confidence ?? undefined,
        linkedAt: link.createdAt,
      };
    });
  }

  /**
   * Search propositions by title (for "Track on Ballot" UI).
   */
  async searchPropositions(query: string) {
    if (!query || query.length < 2) return [];
    return this.db.proposition.findMany({
      where: {
        deletedAt: null,
        title: { contains: query, mode: 'insensitive' },
      },
      select: { id: true, title: true, externalId: true, status: true },
      take: 10,
      orderBy: { electionDate: 'desc' },
    });
  }
}
