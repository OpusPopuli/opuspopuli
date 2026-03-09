import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { LinkingService } from './linking.service';

describe('LinkingService', () => {
  let service: LinkingService;
  let db: {
    document: {
      findFirst: jest.Mock;
    };
    proposition: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    documentProposition: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    db = {
      document: {
        findFirst: jest.fn(),
      },
      proposition: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      documentProposition: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LinkingService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<LinkingService>(LinkingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('matchAndLinkPropositions', () => {
    it('should match and link propositions', async () => {
      db.proposition.findFirst.mockResolvedValue({ id: 'prop-1' });
      db.documentProposition.upsert.mockResolvedValue({ id: 'link-1' });

      const result = await service.matchAndLinkPropositions('doc-1', [
        'Proposition 47',
      ]);

      expect(result.matched).toBe(1);
      expect(result.propositionIds).toEqual(['prop-1']);
      expect(db.documentProposition.upsert).toHaveBeenCalled();
    });

    it('should return zero matches for empty measures', async () => {
      const result = await service.matchAndLinkPropositions('doc-1', []);

      expect(result).toEqual({ matched: 0, propositionIds: [] });
    });

    it('should skip "None identified" measures', async () => {
      const result = await service.matchAndLinkPropositions('doc-1', [
        'None identified',
      ]);

      expect(result.matched).toBe(0);
      expect(db.proposition.findFirst).not.toHaveBeenCalled();
    });

    it('should handle no matching propositions', async () => {
      db.proposition.findFirst.mockResolvedValue(null);

      const result = await service.matchAndLinkPropositions('doc-1', [
        'Unknown measure',
      ]);

      expect(result.matched).toBe(0);
      expect(result.propositionIds).toEqual([]);
    });

    it('should continue on upsert error', async () => {
      db.proposition.findFirst
        .mockResolvedValueOnce({ id: 'prop-1' })
        .mockResolvedValueOnce({ id: 'prop-2' });
      db.documentProposition.upsert
        .mockRejectedValueOnce(new Error('Upsert failed'))
        .mockResolvedValueOnce({ id: 'link-2' });

      const result = await service.matchAndLinkPropositions('doc-1', [
        'Prop A',
        'Prop B',
      ]);

      expect(result.matched).toBe(1);
      expect(result.propositionIds).toEqual(['prop-2']);
    });
  });

  describe('linkDocumentToProposition', () => {
    it('should link a document to a proposition', async () => {
      db.document.findFirst.mockResolvedValue({ id: 'doc-1' });
      db.proposition.findUnique.mockResolvedValue({ id: 'prop-1' });
      db.documentProposition.upsert.mockResolvedValue({ id: 'link-1' });

      const result = await service.linkDocumentToProposition(
        'user-1',
        'doc-1',
        'prop-1',
      );

      expect(result).toEqual({ success: true, linkId: 'link-1' });
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.linkDocumentToProposition('user-1', 'doc-1', 'prop-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when proposition not found', async () => {
      db.document.findFirst.mockResolvedValue({ id: 'doc-1' });
      db.proposition.findUnique.mockResolvedValue(null);

      await expect(
        service.linkDocumentToProposition('user-1', 'doc-1', 'prop-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unlinkDocumentFromProposition', () => {
    it('should unlink and return true', async () => {
      db.document.findFirst.mockResolvedValue({ id: 'doc-1' });
      db.documentProposition.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.unlinkDocumentFromProposition(
        'user-1',
        'doc-1',
        'prop-1',
      );

      expect(result).toBe(true);
      expect(db.documentProposition.deleteMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', propositionId: 'prop-1' },
      });
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.unlinkDocumentFromProposition('user-1', 'doc-1', 'prop-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLinkedPropositions', () => {
    it('should return linked propositions', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          proposition: {
            id: 'prop-1',
            title: 'Prop 47',
            summary: 'Reform',
            status: 'PENDING',
            electionDate: new Date('2024-11-05'),
          },
          linkSource: 'auto_analysis',
          confidence: 0.8,
          matchedText: 'Prop 47',
          createdAt: new Date(),
        },
      ];
      db.documentProposition.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinkedPropositions('doc-1');

      expect(result).toHaveLength(1);
      expect(result[0].propositionId).toBe('prop-1');
      expect(result[0].title).toBe('Prop 47');
      expect(result[0].confidence).toBe(0.8);
    });

    it('should return empty array when no links', async () => {
      db.documentProposition.findMany.mockResolvedValue([]);

      const result = await service.getLinkedPropositions('doc-1');

      expect(result).toEqual([]);
    });
  });

  describe('getLinkedPetitionDocuments', () => {
    it('should return petition documents linked to a proposition', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          document: {
            id: 'doc-1',
            analysis: { summary: 'A petition about parks' },
          },
          linkSource: 'user_manual',
          confidence: null,
          createdAt: new Date(),
        },
      ];
      db.documentProposition.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinkedPetitionDocuments('prop-1');

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].summary).toBe('A petition about parks');
    });

    it('should use fallback summary when analysis is null', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          document: { id: 'doc-1', analysis: null },
          linkSource: 'auto_analysis',
          confidence: 0.5,
          createdAt: new Date(),
        },
      ];
      db.documentProposition.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinkedPetitionDocuments('prop-1');

      expect(result[0].summary).toBe('Petition scan');
    });
  });

  describe('searchPropositions', () => {
    it('should search propositions by query', async () => {
      const mockResults = [
        {
          id: 'prop-1',
          title: 'Proposition 47',
          externalId: 'Prop 47',
          status: 'PENDING',
        },
      ];
      db.proposition.findMany.mockResolvedValue(mockResults);

      const result = await service.searchPropositions('proposition');

      expect(result).toEqual(mockResults);
      expect(db.proposition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            title: { contains: 'proposition', mode: 'insensitive' },
          }),
          take: 10,
        }),
      );
    });

    it('should return empty array for short queries', async () => {
      const result = await service.searchPropositions('a');

      expect(result).toEqual([]);
      expect(db.proposition.findMany).not.toHaveBeenCalled();
    });

    it('should return empty array for empty query', async () => {
      const result = await service.searchPropositions('');

      expect(result).toEqual([]);
    });
  });
});
