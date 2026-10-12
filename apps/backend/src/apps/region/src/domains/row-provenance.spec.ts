import { rowProvenance } from './row-provenance';

describe('rowProvenance', () => {
  it('maps the provenance an item carried out of the pipeline', () => {
    expect(
      rowProvenance({
        pipelineExecutionId: 'exec-1',
        manifestId: 'manifest-1',
        manifestVersion: 11,
        sourceVersionId: 'sv-1',
      }),
    ).toEqual({
      pipelineExecutionId: 'exec-1',
      manifestId: 'manifest-1',
      manifestVersion: 11,
      sourceVersionId: 'sv-1',
    });
  });

  it('writes explicit nulls rather than omitting absent run provenance', () => {
    const columns = rowProvenance({});

    // The distinction matters on upsert: an omitted field leaves whatever was
    // there before, so a row rewritten by an untracked run would keep
    // pointing at the last tracked run that touched it — a stale reference
    // that reads as current, which is worse than no reference.
    expect(columns.pipelineExecutionId).toBeNull();
    expect(columns.manifestId).toBeNull();
    expect(columns.manifestVersion).toBeNull();
  });

  it('nulls only the parts that are missing', () => {
    expect(rowProvenance({ pipelineExecutionId: 'exec-1' })).toMatchObject({
      pipelineExecutionId: 'exec-1',
      manifestId: null,
      manifestVersion: null,
    });
  });

  it('keeps manifest version zero rather than treating it as absent', () => {
    // 0 is falsy and a real version for static-manifest sources; ?? must be
    // the coalescing operator here, never ||.
    expect(rowProvenance({ manifestVersion: 0 }).manifestVersion).toBe(0);
  });

  describe('sourceVersionId follows the text, not the run', () => {
    // It identifies the bytes `fullText` was derived from (#1306), so it
    // cannot take the blanket explicit-null rule above. Two dataSources may
    // write one row — Sonoma's measures are NAMED by a filings page and
    // DOCUMENTED by a voter-guide page, merged on externalId and upserted in
    // config order — and the one that carries no text has nothing to say
    // about which bytes the text came from.

    it('omits it when the write carries no text, so a correct pointer survives', () => {
      // The regression: nulling here orphaned all 15 archived Sonoma guides,
      // leaving 15 source_versions rows that nothing referenced.
      const columns = rowProvenance({ pipelineExecutionId: 'exec-1' });

      expect(columns.sourceVersionId).toBeUndefined();
      // Undefined is not enough on its own — Prisma only skips a field that is
      // ABSENT or undefined, and an explicit null would still clear it.
      expect(columns).not.toHaveProperty('sourceVersionId', null);
    });

    it('still nulls it when the write carries text but no archived bytes', () => {
      // The original intent, preserved exactly: new text whose fetch was not
      // archived must stop pointing at the bytes of an earlier one.
      expect(
        rowProvenance({ fullText: 'fresh text from an unarchived fetch' })
          .sourceVersionId,
      ).toBeNull();
    });

    it('sets it when the write carries both text and its archived bytes', () => {
      expect(
        rowProvenance({ fullText: 'archived text', sourceVersionId: 'sv-9' })
          .sourceVersionId,
      ).toBe('sv-9');
    });

    it('treats empty text as a write, because it replaces what was stored', () => {
      // `fullText: ''` is still a write: it overwrites the stored text, so the
      // pointer to the old bytes becomes stale and must be cleared.
      expect(rowProvenance({ fullText: '' }).sourceVersionId).toBeNull();
    });

    it('keeps the pointer when the item carries it but no text', () => {
      // Nothing about a text-less write should discard a reference the item
      // itself supplied.
      expect(rowProvenance({ sourceVersionId: 'sv-1' }).sourceVersionId).toBe(
        'sv-1',
      );
    });
  });
});
