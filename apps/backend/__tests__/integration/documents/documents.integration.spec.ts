/**
 * Document Integration Tests
 *
 * Tests document operations against real database.
 * Note: Storage operations (S3) are not tested here as they require cloud infrastructure.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createDocument,
  getDbService,
  generateId,
} from '../utils';
import {
  DocumentStatus,
  DocumentType,
  Prisma,
} from '@opuspopuli/relationaldb-provider';

describe('Document Integration Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Document CRUD Operations', () => {
    it('should create a document for a user', async () => {
      const user = await createUser({ email: 'doc-test@example.com' });

      const doc = await createDocument({
        userId: user.id,
        location: 's3://my-bucket',
        key: 'test-file.pdf',
        size: 2048,
        checksum: 'sha256-abc123',
      });

      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.userId).toBe(user.id);
      expect(doc.location).toBe('s3://my-bucket');
      expect(doc.key).toBe('test-file.pdf');
      expect(doc.size).toBe(2048);
      expect(doc.checksum).toBe('sha256-abc123');
      expect(doc.status).toBe(DocumentStatus.processing_pending);
    });

    it('should find a document by ID', async () => {
      const user = await createUser({ email: 'doc-find@example.com' });
      const doc = await createDocument({
        userId: user.id,
        key: 'findable.pdf',
      });

      const db = await getDbService();
      const found = await db.document.findUnique({
        where: { id: doc.id },
      });

      expect(found).toBeDefined();
      expect(found?.id).toBe(doc.id);
      expect(found?.key).toBe('findable.pdf');
    });

    it('should list all documents for a user', async () => {
      const user = await createUser({ email: 'doc-list@example.com' });

      await createDocument({ userId: user.id, key: 'file1.pdf' });
      await createDocument({ userId: user.id, key: 'file2.pdf' });
      await createDocument({ userId: user.id, key: 'file3.pdf' });

      const db = await getDbService();
      const docs = await db.document.findMany({
        where: { userId: user.id },
      });

      expect(docs).toHaveLength(3);
      expect(docs.map((d) => d.key)).toContain('file1.pdf');
      expect(docs.map((d) => d.key)).toContain('file2.pdf');
      expect(docs.map((d) => d.key)).toContain('file3.pdf');
    });

    it('should update document status', async () => {
      const user = await createUser({ email: 'doc-update@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.processing_pending,
      });

      const db = await getDbService();
      const updated = await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.processing_complete },
      });

      expect(updated.status).toBe(DocumentStatus.processing_complete);
    });

    it('should delete a document', async () => {
      const user = await createUser({ email: 'doc-delete@example.com' });
      const doc = await createDocument({
        userId: user.id,
        key: 'to-delete.pdf',
      });

      const db = await getDbService();
      await db.document.delete({ where: { id: doc.id } });

      const deleted = await db.document.findUnique({
        where: { id: doc.id },
      });

      expect(deleted).toBeNull();
    });

    it('should delete documents by user and key', async () => {
      const user = await createUser({ email: 'doc-delete-key@example.com' });
      await createDocument({
        userId: user.id,
        key: 'specific-key.pdf',
      });

      const db = await getDbService();
      const result = await db.document.deleteMany({
        where: { userId: user.id, key: 'specific-key.pdf' },
      });

      expect(result.count).toBe(1);
    });
  });

  describe('Document Status Transitions', () => {
    it('should track document through processing states', async () => {
      const user = await createUser({ email: 'doc-states@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.processing_pending,
      });

      const db = await getDbService();

      // Transition to processing
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_started },
      });

      let current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.text_extraction_started);

      // Transition to complete
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.processing_complete },
      });

      current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.processing_complete);
    });

    it('should mark document as failed', async () => {
      const user = await createUser({ email: 'doc-fail@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.text_extraction_started,
      });

      const db = await getDbService();
      const failed = await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_failed },
      });

      expect(failed.status).toBe(DocumentStatus.text_extraction_failed);
    });
  });

  describe('Document User Isolation', () => {
    it('should not return documents from other users', async () => {
      const user1 = await createUser({ email: 'user1@example.com' });
      const user2 = await createUser({ email: 'user2@example.com' });

      await createDocument({ userId: user1.id, key: 'user1-file.pdf' });
      await createDocument({ userId: user2.id, key: 'user2-file.pdf' });

      const db = await getDbService();

      const user1Docs = await db.document.findMany({
        where: { userId: user1.id },
      });
      const user2Docs = await db.document.findMany({
        where: { userId: user2.id },
      });

      expect(user1Docs).toHaveLength(1);
      expect(user1Docs[0].key).toBe('user1-file.pdf');

      expect(user2Docs).toHaveLength(1);
      expect(user2Docs[0].key).toBe('user2-file.pdf');
    });
  });

  describe('Document Checksum Lookup', () => {
    it('should find document by checksum', async () => {
      const user = await createUser({ email: 'checksum@example.com' });
      const uniqueChecksum = `sha256-${generateId()}`;

      await createDocument({
        userId: user.id,
        key: 'checksummed.pdf',
        checksum: uniqueChecksum,
      });

      const db = await getDbService();
      const found = await db.document.findFirst({
        where: { checksum: uniqueChecksum },
      });

      expect(found).toBeDefined();
      expect(found?.key).toBe('checksummed.pdf');
    });

    it('should detect duplicate documents via checksum', async () => {
      const user = await createUser({ email: 'duplicate@example.com' });
      const sharedChecksum = `sha256-duplicate-${generateId()}`;

      await createDocument({
        userId: user.id,
        key: 'original.pdf',
        checksum: sharedChecksum,
      });

      await createDocument({
        userId: user.id,
        key: 'duplicate.pdf',
        checksum: sharedChecksum,
      });

      const db = await getDbService();
      const duplicates = await db.document.findMany({
        where: { checksum: sharedChecksum },
      });

      expect(duplicates).toHaveLength(2);
    });
  });

  describe('Document Cascade Delete', () => {
    it('should delete documents when user is deleted', async () => {
      const user = await createUser({ email: 'cascade@example.com' });

      await createDocument({ userId: user.id, key: 'file1.pdf' });
      await createDocument({ userId: user.id, key: 'file2.pdf' });

      const db = await getDbService();

      // Verify documents exist
      let docs = await db.document.findMany({ where: { userId: user.id } });
      expect(docs).toHaveLength(2);

      // Delete user (cascade should delete documents)
      await db.user.delete({ where: { id: user.id } });

      // Verify documents are deleted
      docs = await db.document.findMany({ where: { userId: user.id } });
      expect(docs).toHaveLength(0);
    });
  });

  describe('Document Timestamps', () => {
    it('should set createdAt on creation', async () => {
      const user = await createUser({ email: 'timestamp@example.com' });
      const before = new Date();

      const doc = await createDocument({ userId: user.id });

      const after = new Date();

      expect(doc.createdAt).toBeDefined();
      expect(doc.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(doc.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update updatedAt on modification', async () => {
      const user = await createUser({ email: 'update-ts@example.com' });
      const doc = await createDocument({ userId: user.id });

      const originalUpdatedAt = doc.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const db = await getDbService();
      const updated = await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_started },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    });
  });

  describe('Document Type Classification', () => {
    it('should default to generic type', async () => {
      const user = await createUser({ email: 'type-default@example.com' });
      const doc = await createDocument({ userId: user.id });

      expect(doc.type).toBe(DocumentType.generic);
    });

    it('should create document with petition type', async () => {
      const user = await createUser({ email: 'type-petition@example.com' });
      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        key: 'petition-scan.png',
      });

      expect(doc.type).toBe(DocumentType.petition);
    });

    it('should create document with proposition type', async () => {
      const user = await createUser({ email: 'type-proposition@example.com' });
      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.proposition,
        key: 'proposition-doc.pdf',
      });

      expect(doc.type).toBe(DocumentType.proposition);
    });

    it('should filter documents by type', async () => {
      const user = await createUser({ email: 'type-filter@example.com' });

      await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        key: 'petition1.png',
      });
      await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        key: 'petition2.png',
      });
      await createDocument({
        userId: user.id,
        type: DocumentType.generic,
        key: 'generic.pdf',
      });

      const db = await getDbService();
      const petitions = await db.document.findMany({
        where: { userId: user.id, type: DocumentType.petition },
      });

      expect(petitions).toHaveLength(2);
      expect(petitions.every((d) => d.type === DocumentType.petition)).toBe(
        true,
      );
    });
  });

  describe('OCR Result Fields', () => {
    it('should store extracted text', async () => {
      const user = await createUser({ email: 'ocr-text@example.com' });
      const doc = await createDocument({
        userId: user.id,
        extractedText: 'This is the extracted text from the document.',
      });

      expect(doc.extractedText).toBe(
        'This is the extracted text from the document.',
      );
    });

    it('should store OCR confidence and provider', async () => {
      const user = await createUser({ email: 'ocr-confidence@example.com' });
      const doc = await createDocument({
        userId: user.id,
        extractedText: 'OCR result text',
        ocrConfidence: 95.5,
        ocrProvider: 'Tesseract',
      });

      expect(doc.ocrConfidence).toBe(95.5);
      expect(doc.ocrProvider).toBe('Tesseract');
    });

    it('should store content hash for deduplication', async () => {
      const user = await createUser({ email: 'ocr-hash@example.com' });
      const contentHash =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      const doc = await createDocument({
        userId: user.id,
        extractedText: 'Some text',
        contentHash,
      });

      expect(doc.contentHash).toBe(contentHash);
    });

    it('should find documents with same content hash', async () => {
      const user = await createUser({ email: 'ocr-dupe@example.com' });
      const sharedHash = `sha256-content-${generateId()}`;

      await createDocument({
        userId: user.id,
        key: 'original.png',
        extractedText: 'Duplicate content',
        contentHash: sharedHash,
      });
      await createDocument({
        userId: user.id,
        key: 'duplicate.png',
        extractedText: 'Duplicate content',
        contentHash: sharedHash,
      });

      const db = await getDbService();
      const duplicates = await db.document.findMany({
        where: { contentHash: sharedHash },
      });

      expect(duplicates).toHaveLength(2);
    });

    it('should update document with OCR results', async () => {
      const user = await createUser({ email: 'ocr-update@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.text_extraction_started,
      });

      const db = await getDbService();
      const updated = await db.document.update({
        where: { id: doc.id },
        data: {
          extractedText: 'Updated OCR text',
          contentHash: 'new-hash-value',
          ocrConfidence: 88.5,
          ocrProvider: 'Tesseract',
          status: DocumentStatus.text_extraction_complete,
        },
      });

      expect(updated.extractedText).toBe('Updated OCR text');
      expect(updated.ocrConfidence).toBe(88.5);
      expect(updated.ocrProvider).toBe('Tesseract');
      expect(updated.status).toBe(DocumentStatus.text_extraction_complete);
    });
  });

  describe('Document Analysis JSON Field', () => {
    it('should store structured analysis data', async () => {
      const user = await createUser({ email: 'analysis@example.com' });
      const analysisData = {
        petitionType: 'initiative',
        signatureCount: 150,
        dateCollected: '2024-01-15',
        jurisdiction: 'California',
        topics: ['education', 'funding'],
      };

      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        analysis: analysisData,
      });

      expect(doc.analysis).toEqual(analysisData);
    });

    it('should allow querying by analysis fields', async () => {
      const user = await createUser({ email: 'analysis-query@example.com' });

      await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        analysis: { jurisdiction: 'California', signatureCount: 100 },
      });
      await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        analysis: { jurisdiction: 'Texas', signatureCount: 200 },
      });

      const db = await getDbService();
      // Query using Prisma's JSON path filtering
      const californiaDoc = await db.document.findFirst({
        where: {
          userId: user.id,
          analysis: {
            path: ['jurisdiction'],
            equals: 'California',
          },
        },
      });

      expect(californiaDoc).toBeDefined();
      expect(
        (californiaDoc?.analysis as { jurisdiction: string }).jurisdiction,
      ).toBe('California');
    });
  });

  describe('OCR Status Workflow', () => {
    it('should track document through OCR processing states', async () => {
      const user = await createUser({ email: 'ocr-workflow@example.com' });
      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        status: DocumentStatus.processing_pending,
      });

      const db = await getDbService();

      // Start text extraction
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_started },
      });

      let current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.text_extraction_started);

      // Complete extraction
      await db.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.text_extraction_complete,
          extractedText: 'Petition content here',
          ocrConfidence: 92,
          ocrProvider: 'Tesseract',
        },
      });

      current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.text_extraction_complete);
      expect(current?.extractedText).toBe('Petition content here');
    });

    it('should handle extraction failure', async () => {
      const user = await createUser({ email: 'ocr-fail@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.text_extraction_started,
      });

      const db = await getDbService();
      const failed = await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_failed },
      });

      expect(failed.status).toBe(DocumentStatus.text_extraction_failed);
      expect(failed.extractedText).toBeNull();
    });
  });

  describe('AI Analysis Status Workflow', () => {
    it('should track document through AI analysis states', async () => {
      const user = await createUser({ email: 'analysis-workflow@example.com' });
      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        status: DocumentStatus.text_extraction_complete,
        extractedText: 'This is a petition to increase the minimum wage...',
        contentHash: 'hash-analysis-test',
      });

      const db = await getDbService();

      // Start AI analysis
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.ai_analysis_started },
      });

      let current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.ai_analysis_started);

      // Complete analysis
      const analysisResult = {
        documentType: 'petition',
        summary: 'A petition to raise the minimum wage to $20/hour',
        keyPoints: ['Increase to $20/hour', 'Phased implementation'],
        entities: ['State Legislature', 'Workers Union'],
        actualEffect: 'Would mandate higher minimum wage statewide',
        potentialConcerns: ['Cost impact on small businesses'],
        beneficiaries: ['Low-wage workers'],
        potentiallyHarmed: ['Small business owners'],
        relatedMeasures: ['Prop 15 from 2020'],
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 1500,
      };

      await db.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.ai_analysis_complete,
          analysis: analysisResult,
        },
      });

      current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.ai_analysis_complete);
      expect(current?.analysis).toBeDefined();

      const analysis = current?.analysis as typeof analysisResult;
      expect(analysis.summary).toBe(
        'A petition to raise the minimum wage to $20/hour',
      );
      expect(analysis.provider).toBe('Ollama');
    });

    it('should handle AI analysis failure', async () => {
      const user = await createUser({ email: 'analysis-fail@example.com' });
      const doc = await createDocument({
        userId: user.id,
        status: DocumentStatus.ai_analysis_started,
        extractedText: 'Some content',
      });

      const db = await getDbService();
      const failed = await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.ai_analysis_failed },
      });

      expect(failed.status).toBe(DocumentStatus.ai_analysis_failed);
      expect(failed.analysis).toBeNull();
    });
  });

  describe('Analysis Caching by contentHash', () => {
    it('should find cached analysis by contentHash and type', async () => {
      const user = await createUser({ email: 'cache-test@example.com' });
      const sharedHash = `content-hash-${generateId()}`;

      const analysisData = {
        summary: 'Shared analysis result',
        keyPoints: ['Key point 1'],
        entities: ['Entity 1'],
        documentType: 'petition',
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 1000,
      };

      // Create first document with analysis
      await createDocument({
        userId: user.id,
        key: 'original-petition.pdf',
        type: DocumentType.petition,
        extractedText: 'Same petition content',
        contentHash: sharedHash,
        status: DocumentStatus.ai_analysis_complete,
        analysis: analysisData,
      });

      // Create second document with same contentHash, no analysis yet
      const doc2 = await createDocument({
        userId: user.id,
        key: 'duplicate-petition.pdf',
        type: DocumentType.petition,
        extractedText: 'Same petition content',
        contentHash: sharedHash,
        status: DocumentStatus.text_extraction_complete,
      });

      const db = await getDbService();

      // Query for cached analysis (same contentHash + type)
      const cached = await db.document.findFirst({
        where: {
          contentHash: sharedHash,
          type: DocumentType.petition,
          analysis: { not: Prisma.DbNull },
        },
        select: { id: true, analysis: true },
      });

      expect(cached).toBeDefined();
      expect(cached?.id).not.toBe(doc2.id);
      expect((cached?.analysis as typeof analysisData).summary).toBe(
        'Shared analysis result',
      );
    });

    it('should not share analysis between different document types', async () => {
      const user = await createUser({ email: 'type-isolation@example.com' });
      const sharedHash = `hash-type-test-${generateId()}`;

      // Create petition with analysis
      await createDocument({
        userId: user.id,
        key: 'petition.pdf',
        type: DocumentType.petition,
        extractedText: 'Shared content',
        contentHash: sharedHash,
        status: DocumentStatus.ai_analysis_complete,
        analysis: {
          summary: 'Petition analysis',
          documentType: 'petition',
        },
      });

      const db = await getDbService();

      // Query for contract type with same hash - should not find
      const cachedForContract = await db.document.findFirst({
        where: {
          contentHash: sharedHash,
          type: DocumentType.contract,
          analysis: { not: Prisma.DbNull },
        },
      });

      expect(cachedForContract).toBeNull();
    });
  });

  describe('Document Analysis by Type', () => {
    it('should store petition analysis with civic fields', async () => {
      const user = await createUser({ email: 'petition-analysis@example.com' });
      const analysisData = {
        documentType: 'petition',
        summary: 'Initiative to fund public schools',
        keyPoints: ['Increase property tax', 'Fund K-12 education'],
        entities: ['State Board of Education'],
        actualEffect: 'Would increase property taxes by 1%',
        potentialConcerns: ['Tax burden on homeowners'],
        beneficiaries: ['Public school students'],
        potentiallyHarmed: ['Property owners'],
        relatedMeasures: ['Prop 30 from 2012'],
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 1200,
      };

      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.petition,
        extractedText: 'Education funding petition text...',
        status: DocumentStatus.ai_analysis_complete,
        analysis: analysisData,
      });

      const db = await getDbService();
      const retrieved = await db.document.findUnique({
        where: { id: doc.id },
      });

      const analysis = retrieved?.analysis as typeof analysisData;
      expect(analysis.actualEffect).toBe('Would increase property taxes by 1%');
      expect(analysis.beneficiaries).toContain('Public school students');
    });

    it('should store contract analysis with contract-specific fields', async () => {
      const user = await createUser({
        email: 'contract-analysis@example.com',
      });
      const analysisData = {
        documentType: 'contract',
        summary: 'Service agreement between two parties',
        keyPoints: ['1 year term', 'Auto-renewal'],
        entities: ['Acme Corp', 'Widget Inc'],
        parties: ['Acme Corp', 'Widget Inc'],
        obligations: ['Acme provides services', 'Widget pays monthly'],
        risks: ['Early termination penalties'],
        effectiveDate: '2024-01-01',
        terminationClause: '30 days written notice required',
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 800,
      };

      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.contract,
        extractedText: 'Contract agreement text...',
        status: DocumentStatus.ai_analysis_complete,
        analysis: analysisData,
      });

      const db = await getDbService();
      const retrieved = await db.document.findUnique({
        where: { id: doc.id },
      });

      const analysis = retrieved?.analysis as typeof analysisData;
      expect(analysis.parties).toContain('Acme Corp');
      expect(analysis.terminationClause).toBe(
        '30 days written notice required',
      );
    });

    it('should store form analysis with form-specific fields', async () => {
      const user = await createUser({ email: 'form-analysis@example.com' });
      const analysisData = {
        documentType: 'form',
        summary: 'Tax filing form for small businesses',
        keyPoints: ['Annual filing required', 'Due April 15'],
        entities: ['IRS', 'State Tax Board'],
        requiredFields: ['Business name', 'EIN', 'Revenue'],
        purpose: 'Annual business tax reporting',
        submissionDeadline: 'April 15, 2024',
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 600,
      };

      const doc = await createDocument({
        userId: user.id,
        type: DocumentType.form,
        extractedText: 'Tax form content...',
        status: DocumentStatus.ai_analysis_complete,
        analysis: analysisData,
      });

      const db = await getDbService();
      const retrieved = await db.document.findUnique({
        where: { id: doc.id },
      });

      const analysis = retrieved?.analysis as typeof analysisData;
      expect(analysis.requiredFields).toContain('EIN');
      expect(analysis.submissionDeadline).toBe('April 15, 2024');
    });
  });

  describe('Full Document Processing Pipeline', () => {
    it('should complete full pipeline: upload -> extract -> analyze', async () => {
      const user = await createUser({ email: 'pipeline@example.com' });
      const db = await getDbService();

      // Step 1: Create document (simulating upload)
      const doc = await createDocument({
        userId: user.id,
        key: 'petition-scan.png',
        type: DocumentType.petition,
        status: DocumentStatus.processing_pending,
      });

      expect(doc.status).toBe(DocumentStatus.processing_pending);

      // Step 2: Start text extraction
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.text_extraction_started },
      });

      // Step 3: Complete text extraction
      const extractedText =
        'We the undersigned petition for increased funding...';
      const contentHash = 'sha256-extracted-content-hash';

      await db.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.text_extraction_complete,
          extractedText,
          contentHash,
          ocrConfidence: 95.5,
          ocrProvider: 'Tesseract',
        },
      });

      let current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.text_extraction_complete);
      expect(current?.extractedText).toBe(extractedText);

      // Step 4: Start AI analysis
      await db.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.ai_analysis_started },
      });

      // Step 5: Complete AI analysis
      const analysis = {
        documentType: 'petition',
        summary: 'Petition for increased education funding',
        keyPoints: ['Increase state budget allocation'],
        entities: ['State Education Department'],
        actualEffect: 'Would require additional $1B in education spending',
        potentialConcerns: ['Budget constraints'],
        beneficiaries: ['Public schools'],
        potentiallyHarmed: ['Taxpayers'],
        relatedMeasures: [],
        analyzedAt: new Date().toISOString(),
        provider: 'Ollama',
        model: 'llama3.2',
        processingTimeMs: 2000,
      };

      await db.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.ai_analysis_complete,
          analysis,
        },
      });

      // Verify final state
      current = await db.document.findUnique({ where: { id: doc.id } });
      expect(current?.status).toBe(DocumentStatus.ai_analysis_complete);
      expect(current?.extractedText).toBe(extractedText);
      expect(current?.ocrConfidence).toBe(95.5);

      const finalAnalysis = current?.analysis as typeof analysis;
      expect(finalAnalysis.summary).toBe(
        'Petition for increased education funding',
      );
      expect(finalAnalysis.provider).toBe('Ollama');
    });
  });

  describe('PostGIS Location Tracking', () => {
    it('should set and retrieve scan location', async () => {
      const user = await createUser({ email: 'location-test@example.com' });
      const doc = await createDocument({
        userId: user.id,
        key: 'petition.png',
      });

      const db = await getDbService();

      // Set location using raw SQL (PostGIS)
      const latitude = 37.7749;
      const longitude = -122.4194;

      await db.$executeRaw`
        UPDATE documents
        SET scan_location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        WHERE id::text = ${doc.id}
      `;

      // Retrieve location
      const result = await db.$queryRaw<
        Array<{ latitude: number; longitude: number }>
      >`
        SELECT
          ST_Y(scan_location::geometry) as latitude,
          ST_X(scan_location::geometry) as longitude
        FROM documents
        WHERE id::text = ${doc.id} AND scan_location IS NOT NULL
      `;

      expect(result).toHaveLength(1);
      expect(result[0].latitude).toBeCloseTo(latitude, 4);
      expect(result[0].longitude).toBeCloseTo(longitude, 4);
    });

    it('should return empty result when location not set', async () => {
      const user = await createUser({ email: 'no-location@example.com' });
      const doc = await createDocument({ userId: user.id });

      const db = await getDbService();

      const result = await db.$queryRaw<
        Array<{ latitude: number; longitude: number }>
      >`
        SELECT
          ST_Y(scan_location::geometry) as latitude,
          ST_X(scan_location::geometry) as longitude
        FROM documents
        WHERE id::text = ${doc.id} AND scan_location IS NOT NULL
      `;

      expect(result).toHaveLength(0);
    });

    it('should find documents near a location using ST_DWithin', async () => {
      const user = await createUser({ email: 'proximity@example.com' });
      const sharedHash = `proximity-test-${generateId()}`;

      // Create documents at different locations with same content hash
      const doc1 = await createDocument({
        userId: user.id,
        key: 'nearby1.png',
        contentHash: sharedHash,
      });
      const doc2 = await createDocument({
        userId: user.id,
        key: 'nearby2.png',
        contentHash: sharedHash,
      });
      const doc3 = await createDocument({
        userId: user.id,
        key: 'far-away.png',
        contentHash: sharedHash,
      });

      const db = await getDbService();

      // Set locations: doc1 at SF, doc2 at Oakland (~15km), doc3 at LA (~600km)
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
        WHERE id::text = ${doc1.id}
      `;
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-122.2711, 37.8044), 4326)::geography
        WHERE id::text = ${doc2.id}
      `;
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)::geography
        WHERE id::text = ${doc3.id}
      `;

      // Query for documents within 20km of SF
      const nearbyResults = await db.$queryRaw<
        Array<{ id: string; distance_meters: number }>
      >`
        SELECT
          id,
          ST_Distance(
            scan_location,
            ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
          ) as distance_meters
        FROM documents
        WHERE
          content_hash = ${sharedHash}
          AND scan_location IS NOT NULL
          AND ST_DWithin(
            scan_location,
            ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography,
            20000
          )
        ORDER BY distance_meters ASC
      `;

      // Should find doc1 (at search point) and doc2 (Oakland, ~15km)
      expect(nearbyResults).toHaveLength(2);
      expect(nearbyResults[0].id).toBe(doc1.id);
      expect(nearbyResults[0].distance_meters).toBeLessThan(100); // At search point
      expect(nearbyResults[1].id).toBe(doc2.id);
      expect(nearbyResults[1].distance_meters).toBeLessThan(20000); // Within 20km
    });

    it('should calculate accurate distances between points', async () => {
      const user = await createUser({ email: 'distance-test@example.com' });
      const doc = await createDocument({ userId: user.id });

      const db = await getDbService();

      // Set location at SF
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
        WHERE id::text = ${doc.id}
      `;

      // Calculate distance to Oakland (known to be ~13-15km)
      const result = await db.$queryRaw<Array<{ distance_meters: number }>>`
        SELECT ST_Distance(
          scan_location,
          ST_SetSRID(ST_MakePoint(-122.2711, 37.8044), 4326)::geography
        ) as distance_meters
        FROM documents
        WHERE id::text = ${doc.id}
      `;

      // SF to Oakland is approximately 13-15km
      expect(result[0].distance_meters).toBeGreaterThan(12000);
      expect(result[0].distance_meters).toBeLessThan(16000);
    });

    it('should only find documents with matching content hash', async () => {
      const user = await createUser({ email: 'hash-filter@example.com' });

      const doc1 = await createDocument({
        userId: user.id,
        key: 'petition-a.png',
        contentHash: 'hash-a',
      });
      const doc2 = await createDocument({
        userId: user.id,
        key: 'petition-b.png',
        contentHash: 'hash-b',
      });

      const db = await getDbService();

      // Set same location for both
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
        WHERE id::text = ${doc1.id}
      `;
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
        WHERE id::text = ${doc2.id}
      `;

      // Query for hash-a only
      const results = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM documents
        WHERE
          content_hash = 'hash-a'
          AND scan_location IS NOT NULL
          AND ST_DWithin(
            scan_location,
            ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography,
            1000
          )
      `;

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(doc1.id);
    });

    it('should handle edge case coordinates', async () => {
      const user = await createUser({ email: 'edge-coords@example.com' });
      const doc = await createDocument({ userId: user.id });

      const db = await getDbService();

      // Test near the antimeridian (date line)
      await db.$executeRaw`
        UPDATE documents SET scan_location = ST_SetSRID(ST_MakePoint(179.9, 0), 4326)::geography
        WHERE id::text = ${doc.id}
      `;

      const result = await db.$queryRaw<
        Array<{ latitude: number; longitude: number }>
      >`
        SELECT
          ST_Y(scan_location::geometry) as latitude,
          ST_X(scan_location::geometry) as longitude
        FROM documents
        WHERE id::text = ${doc.id}
      `;

      expect(result[0].latitude).toBeCloseTo(0, 4);
      expect(result[0].longitude).toBeCloseTo(179.9, 4);
    });
  });
});
