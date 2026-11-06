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
      },
    }).toEqual(latest);
  });
});
