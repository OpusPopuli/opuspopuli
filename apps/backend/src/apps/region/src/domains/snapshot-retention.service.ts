import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { IStorageProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  assertRetainsSomething,
  selectRetainedSnapshots,
} from './snapshot-retention';

/** What a sweep did. */
export interface SweepResult {
  /** Snapshots whose payloads were kept */
  retained: number;
  /** Snapshots whose payloads were deleted */
  pruned: number;
  /** Payloads that could not be deleted from storage */
  failed: number;
}

/**
 * Applies the bulk tier's retention schedule (#1277).
 *
 * Deletes payloads, never rows. A pruned snapshot keeps its metadata — hash,
 * URL, fetch time, producing run — because a finance row's provenance resolves
 * through that row rather than through its bytes. Dropping the row to reclaim
 * a few hundred bytes would break the chain the payload was there to support.
 *
 * The selection is computed as "what to keep" and the complement is deleted,
 * with an invariant check in between: see {@link selectRetainedSnapshots} for
 * why that direction matters when the operation is destructive.
 */
@Injectable()
export class SnapshotRetentionService {
  private readonly logger = new Logger(SnapshotRetentionService.name);

  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject('STORAGE_PROVIDER')
    private readonly storage: IStorageProvider | null,
  ) {}

  /**
   * Prune payloads that the retention schedule does not keep.
   *
   * @returns Counts of retained, pruned and failed payloads
   */
  async sweep(): Promise<SweepResult> {
    const candidates = await this.db.bulkSnapshot.findMany({
      where: { prunedAt: null, storageKey: { not: null } },
      select: {
        id: true,
        sourceUrl: true,
        fetchedAt: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    if (candidates.length === 0) {
      return { retained: 0, pruned: 0, failed: 0 };
    }

    const keep = selectRetainedSnapshots(candidates);
    // Throws rather than proceeding. A rules bug that selected nothing would
    // otherwise delete every archived export in one pass.
    assertRetainsSomething(candidates, keep);

    const prunable = candidates.filter((snapshot) => !keep.has(snapshot.id));
    let pruned = 0;
    let failed = 0;

    for (const snapshot of prunable) {
      if (
        await this.deletePayload(snapshot.storageBucket, snapshot.storageKey)
      ) {
        await this.db.bulkSnapshot.update({
          where: { id: snapshot.id },
          data: {
            prunedAt: new Date(),
            storageBucket: null,
            storageKey: null,
          },
        });
        pruned++;
      } else {
        failed++;
      }
    }

    this.logger.log(
      `Snapshot retention: kept ${keep.size}, pruned ${pruned}` +
        (failed > 0 ? `, ${failed} failed` : ''),
    );

    return { retained: keep.size, pruned, failed };
  }

  /**
   * Remove one payload from storage.
   *
   * The row is only marked pruned when this succeeds. Marking it regardless
   * would strand the object: nothing would reference it, so nothing would ever
   * retry the delete, and the bytes this tier exists to bound would accumulate
   * invisibly.
   */
  private async deletePayload(
    bucket: string | null,
    key: string | null,
  ): Promise<boolean> {
    if (!bucket || !key) return false;

    if (!this.storage) {
      this.logger.warn(
        'No storage provider bound — cannot prune snapshot payloads',
      );
      return false;
    }

    try {
      return await this.storage.deleteFile(bucket, key);
    } catch (error) {
      this.logger.warn(
        `Failed to prune ${bucket}/${key}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
