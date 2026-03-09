import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { DocumentCrudService } from './document-crud.service';

describe('DocumentCrudService', () => {
  let service: DocumentCrudService;
  let db: {
    document: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    db = {
      document: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentCrudService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<DocumentCrudService>(DocumentCrudService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDocumentById', () => {
    it('should return a document when found', async () => {
      const mockDoc = { id: 'doc-1', key: 'file.pdf', userId: 'user-1' };
      db.document.findUnique.mockResolvedValue(mockDoc);

      const result = await service.getDocumentById('doc-1');

      expect(result).toEqual(mockDoc);
      expect(db.document.findUnique).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
    });

    it('should return null when document not found', async () => {
      db.document.findUnique.mockResolvedValue(null);

      const result = await service.getDocumentById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createDocument', () => {
    it('should create and return a new document', async () => {
      const mockDoc = {
        id: 'doc-1',
        location: 'bucket/user-1/file.pdf',
        userId: 'user-1',
        key: 'file.pdf',
        size: 1024,
        checksum: 'abc123',
      };
      db.document.create.mockResolvedValue(mockDoc);

      const result = await service.createDocument(
        'bucket/user-1/file.pdf',
        'user-1',
        'file.pdf',
        1024,
        'abc123',
      );

      expect(result).toEqual(mockDoc);
      expect(db.document.create).toHaveBeenCalledWith({
        data: {
          location: 'bucket/user-1/file.pdf',
          userId: 'user-1',
          key: 'file.pdf',
          size: 1024,
          checksum: 'abc123',
        },
      });
    });
  });

  describe('updateDocument', () => {
    it('should update a document', async () => {
      db.document.update.mockResolvedValue({});

      await service.updateDocument('doc-1', { status: 'ai_analysis_complete' });

      expect(db.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'ai_analysis_complete' },
      });
    });
  });
});
