import { Test } from '@nestjs/testing';
import {
  ExtractionModule,
  ExtractionProvider,
  OCR_SERVICE,
  SOURCE_ARCHIVE,
  type ISourceArchive,
} from '@opuspopuli/extraction-provider';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PrismaSourceArchive } from './prisma-source-archive';
import { SourceVersionService } from '../domains/source-version.service';

describe('PrismaSourceArchive', () => {
  describe('DI registration', () => {
    it("resolves SOURCE_ARCHIVE inside ExtractionModule's own scope", async () => {
      // The failure this guards is specific and has bitten this codebase
      // before (see the OCR_SERVICE comment in region.module.ts): providers
      // declared at an outer module's scope are invisible to
      // ExtractionProvider, which injects the token from inside
      // ExtractionModule. Registered in the wrong place, the token silently
      // resolves to undefined and nothing is ever archived — no error, no
      // failing test, just an empty store.
      const db = {
        sourceVersion: { findUnique: jest.fn(), create: jest.fn() },
      };

      const module = await Test.createTestingModule({
        imports: [
          ExtractionModule.forRoot({
            extraProviders: [
              { provide: OCR_SERVICE, useValue: null },
              { provide: DbService, useValue: db },
              SourceVersionService,
              PrismaSourceArchive,
              { provide: SOURCE_ARCHIVE, useExisting: PrismaSourceArchive },
            ],
          }),
        ],
      }).compile();

      const provider = module.get(ExtractionProvider, { strict: false });
      expect(provider).toBeDefined();
      expect(module.get(SOURCE_ARCHIVE, { strict: false })).toBeInstanceOf(
        PrismaSourceArchive,
      );

      await module.close();
    });
  });

  describe('archive', () => {
    let sourceVersions: { record: jest.Mock };
    let archive: ISourceArchive;

    const input = {
      content: Buffer.from('<html>Measure A</html>', 'utf8'),
      contentHash: 'a'.repeat(64),
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: 'https://example.gov/a',
      contentType: 'text/html',
      regionId: 'us-ca',
      dataType: 'propositions',
    };

    beforeEach(() => {
      sourceVersions = {
        record: jest.fn().mockResolvedValue({
          contentHash: 'a'.repeat(64),
          stored: true,
        }),
      };
      archive = new PrismaSourceArchive(
        sourceVersions as unknown as SourceVersionService,
      );
    });

    it('forwards the fetch provenance to the store', async () => {
      await archive.archive(input);

      expect(sourceVersions.record).toHaveBeenCalledWith(
        expect.objectContaining({
          contentHash: 'a'.repeat(64),
          sourceUrl: 'https://example.gov/a',
          fetchedAt: '2026-09-18T10:00:00.000Z',
          regionId: 'us-ca',
          dataType: 'propositions',
        }),
      );
    });

    it('does not throw when the store refuses the artifact', async () => {
      sourceVersions.record.mockResolvedValue({
        contentHash: 'a'.repeat(64),
        stored: false,
        skippedReason: 'too-large',
      });

      // Resolves, and carries NO id: the bytes were refused, so there is
      // nothing for a row to point at. Returning the content hash here would
      // hand the caller an identity for something nobody kept (#1306).
      await expect(archive.archive(input)).resolves.toEqual({});
    });
  });
});
