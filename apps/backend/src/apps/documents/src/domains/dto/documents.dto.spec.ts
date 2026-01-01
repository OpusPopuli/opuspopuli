import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FilenameInput } from './documents.dto';

describe('Documents DTOs', () => {
  describe('FilenameInput', () => {
    it('should pass validation for valid filename', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'document.pdf',
      });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation for filename with underscores and hyphens', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'my_document-v2.pdf',
      });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation for alphanumeric filename', async () => {
      const input = plainToInstance(FilenameInput, { filename: 'file123' });
      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });

    // Path traversal attack prevention
    it('should fail validation for path traversal with ../', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: '../etc/passwd',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for path traversal with /', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'path/to/file.txt',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for path traversal with backslash', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'path\\to\\file.txt',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for filename starting with dot', async () => {
      const input = plainToInstance(FilenameInput, { filename: '.hidden' });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for empty filename', async () => {
      const input = plainToInstance(FilenameInput, { filename: '' });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for filename exceeding 255 characters', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'a'.repeat(256),
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });

    it('should fail validation for filename with null byte', async () => {
      const input = plainToInstance(FilenameInput, {
        filename: 'file\0.txt',
      });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for filename with only spaces', async () => {
      const input = plainToInstance(FilenameInput, { filename: '   ' });
      const errors = await validate(input);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
