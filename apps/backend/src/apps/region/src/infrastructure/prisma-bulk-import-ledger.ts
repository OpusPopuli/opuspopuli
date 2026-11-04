import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { IBulkImportLedger } from '@opuspopuli/scraping-pipeline';

/**
 * `bulk_imports`: the last completed import of each bulk source
 * (`docs/plans/campaign-finance-phase-b.md`, D3).
 *
 * Never throws, per the port. An unreadable ledger answers "nothing
 * completed", so every row is written; a failed write costs the next sync
 * its skip, never a stale row.
 */
@Injectable()
export class PrismaBulkImportLedger implements IBulkImportLedger {
  private readonly logger = new Logger(PrismaBulkImportLedger.name);

  constructor(private readonly db: DbService) {}

  async lastCompletedKey(sourceKey: string): Promise<string | undefined> {
    try {
      const row = await this.db.bulkImport.findUnique({
        where: { sourceKey },
        select: { importKey: true },
      });
      return row?.importKey;
    } catch (error) {
      this.logger.warn(
        `Could not read the import ledger: ${(error as Error).name}`,
      );
      return undefined;
    }
  }

  async recordCompleted(
    sourceKey: string,
    importKey: string,
    executionId: string | null,
  ): Promise<void> {
    const completed = { importKey, executionId, completedAt: new Date() };
    try {
      await this.db.bulkImport.upsert({
        where: { sourceKey },
        create: { sourceKey, ...completed },
        update: completed,
      });
    } catch (error) {
      this.logger.warn(
        `Could not record a completed import: ${(error as Error).name}`,
      );
    }
  }

  async forget(sourceKey: string): Promise<void> {
    try {
      await this.db.bulkImport.deleteMany({ where: { sourceKey } });
    } catch (error) {
      this.logger.warn(
        `Could not clear an import from the ledger: ${(error as Error).name}`,
      );
    }
  }
}
