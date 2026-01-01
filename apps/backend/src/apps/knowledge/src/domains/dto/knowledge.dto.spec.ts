import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryInput, SearchInput, IndexDocumentInput } from './knowledge.dto';

describe('Knowledge DTOs', () => {
  describe('QueryInput', () => {
    it('should pass validation for valid query', async () => {
      const input = plainToInstance(QueryInput, { query: 'What is this?' });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for empty query', async () => {
      const input = plainToInstance(QueryInput, { query: '' });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for query exceeding max length', async () => {
      const input = plainToInstance(QueryInput, { query: 'a'.repeat(10001) });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });

  describe('SearchInput', () => {
    it('should pass validation for valid search input', async () => {
      const input = plainToInstance(SearchInput, {
        query: 'search term',
        skip: 0,
        take: 10,
      });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for negative skip', async () => {
      const input = plainToInstance(SearchInput, {
        query: 'search',
        skip: -1,
        take: 10,
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for skip exceeding 10000', async () => {
      const input = plainToInstance(SearchInput, {
        query: 'search',
        skip: 10001,
        take: 10,
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('max');
    });

    it('should fail validation for take exceeding 100', async () => {
      const input = plainToInstance(SearchInput, {
        query: 'search',
        skip: 0,
        take: 101,
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('max');
    });

    it('should fail validation for take less than 1', async () => {
      const input = plainToInstance(SearchInput, {
        query: 'search',
        skip: 0,
        take: 0,
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('IndexDocumentInput', () => {
    it('should pass validation for valid input', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: 'doc-123',
        text: 'Document content',
      });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation for documentId with underscores and hyphens', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: 'my_doc-123_test',
        text: 'Content',
      });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for documentId with special characters', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: 'doc/123',
        text: 'Content',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for documentId with path traversal', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: '../etc/passwd',
        text: 'Content',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for empty documentId', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: '',
        text: 'Content',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for text exceeding 1MB', async () => {
      const input = plainToInstance(IndexDocumentInput, {
        documentId: 'doc-1',
        text: 'a'.repeat(1000001),
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });
});
