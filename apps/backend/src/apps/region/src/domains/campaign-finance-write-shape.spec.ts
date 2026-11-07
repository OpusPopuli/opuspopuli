import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BULK_MAPPING_VERSION } from '@opuspopuli/scraping-pipeline';

/**
 * What the finance sync writes for a record, pinned to the mapping version
 * (`docs/plans/campaign-finance-phase-b.md`, D2).
 *
 * A row the sync skips as unchanged (K4) keeps whatever its last write gave
 * it. A change to the write shape (a field added, a field made clearable, a
 * table made amendable) or to which table a record is routed to therefore
 * reaches only the rows that change, unless `BULK_MAPPING_VERSION` is bumped
 * so the next sync writes every row once.
 *
 * When this fails: bump the version in scraping-pipeline (and pin it there),
 * then add an entry here with the hashes the failure prints. Never edit an
 * old entry, except as `bulk-import-key.spec.ts` allows for a version that
 * has never left dev (how bm1 was re-pinned for F8, and again when the
 * pubinfo bills write shape joined the pin: its tables are new). A reformat trips it
 * too; that costs one full rewrite, which is cheaper than a missed bump.
 */
const PINNED_FILES = {
  writeShape: join(__dirname, 'campaign-finance-write-shape.ts'),
  routing: join(
    __dirname,
    '../../../../../../../packages/common/src/providers/region/finance-routing.ts',
  ),
  // The bills mirrors are a bulk write shape too (bills-phase-b.md, D10).
  billsWriteShape: join(__dirname, 'bills-pubinfo-write-shape.ts'),
  // So is what the bills sync derives from them: a bill is derived again
  // only when one of its lines changes, so a derive change needs a bump too.
  billsDerive: join(__dirname, 'bills-pubinfo-derive.ts'),
  billsSync: join(__dirname, 'bills-pubinfo-sync.service.ts'),
  // A bill's flags come from these, so a change to either alters what an
  // unchanged line's bill becomes (review of the final diff).
  billLifecycle: join(__dirname, 'bill-lifecycle.ts'),
  billLifecycleWriter: join(__dirname, 'bill-lifecycle-writer.ts'),
};

const PINS: { version: string; files: Record<string, string> }[] = [
  {
    version: 'bm1',
    files: {
      writeShape:
        'd46277fe1f25132ae0231325ad4a468f651ea807814640cf830d8eb3d4d917d3',
      routing:
        'd7a0a6fe9eb69212b359d58a4e542e99a6e5f59f590b068adfcaa1f350a6cc88',
      billsWriteShape:
        '033cc3971012617482c15c4c2cc1c5ba7c25dabe5241d856b5804a15f6cedbf3',
    },
  },
  {
    // The bills derive joins the pin: same-day roll calls, history tie-break.
    version: 'bm2',
    files: {
      writeShape:
        'd46277fe1f25132ae0231325ad4a468f651ea807814640cf830d8eb3d4d917d3',
      routing:
        'd7a0a6fe9eb69212b359d58a4e542e99a6e5f59f590b068adfcaa1f350a6cc88',
      billsWriteShape:
        '033cc3971012617482c15c4c2cc1c5ba7c25dabe5241d856b5804a15f6cedbf3',
      billsDerive:
        'c3a00aadf906fea94fb754dbf68ce32e5d98d8d95ac00a13a2832c566b2618fd',
      billsSync:
        '40f61c9b90995d001365a8289e0995effaf3ab99ee0b49e504c4ad5209cd1f20',
    },
  },
  {
    // The derive is crash-safe and links by seat holder; lifecycle files pinned.
    // Re-pinned in place (never left dev) for the links fingerprint: it only
    // changes the derive, and the new NULL column re-derives every bill.
    version: 'bm3',
    files: {
      writeShape:
        'd46277fe1f25132ae0231325ad4a468f651ea807814640cf830d8eb3d4d917d3',
      routing:
        'd7a0a6fe9eb69212b359d58a4e542e99a6e5f59f590b068adfcaa1f350a6cc88',
      billsWriteShape:
        '033cc3971012617482c15c4c2cc1c5ba7c25dabe5241d856b5804a15f6cedbf3',
      billsDerive:
        '05d699c576c083b76b4f67596268853d7586e70188020c2a3e3a2ed39beff9ad',
      billsSync:
        'c44710a9c1d75f9cb781812213a55dc5a35f4b0e13df7bcdfce6a94a64a4b2b9',
      billLifecycle:
        '088a2d4f6c9cf157a47a453453e21dc3b2d6553a59d5e2d5393d451915787621',
      billLifecycleWriter:
        '89e0295e7c720e77b618031f87c6a9ca59869064d51428b46b574733d35758cb',
    },
  },
];

function hashOf(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path, 'utf8'), 'utf8')
    .digest('hex');
}

describe('the finance write shape (campaign-finance-phase-b.md, D2)', () => {
  it('is pinned to the current mapping version', () => {
    const latest = PINS[PINS.length - 1];

    expect({
      version: BULK_MAPPING_VERSION,
      files: {
        writeShape: hashOf(PINNED_FILES.writeShape),
        routing: hashOf(PINNED_FILES.routing),
        billsWriteShape: hashOf(PINNED_FILES.billsWriteShape),
        billsDerive: hashOf(PINNED_FILES.billsDerive),
        billsSync: hashOf(PINNED_FILES.billsSync),
        billLifecycle: hashOf(PINNED_FILES.billLifecycle),
        billLifecycleWriter: hashOf(PINNED_FILES.billLifecycleWriter),
      },
    }).toEqual(latest);
  });
});
