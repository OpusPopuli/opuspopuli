import { rowProvenance } from './row-provenance';

describe('rowProvenance', () => {
  it('maps the provenance an item carried out of the pipeline', () => {
    expect(
      rowProvenance({
        pipelineExecutionId: 'exec-1',
        manifestId: 'manifest-1',
        manifestVersion: 11,
      }),
    ).toEqual({
      pipelineExecutionId: 'exec-1',
      manifestId: 'manifest-1',
      manifestVersion: 11,
    });
  });

  it('writes explicit nulls rather than omitting absent values', () => {
    const columns = rowProvenance({});

    // The distinction matters on upsert: an omitted field leaves whatever was
    // there before, so a row rewritten by an untracked run would keep
    // pointing at the last tracked run that touched it — a stale reference
    // that reads as current, which is worse than no reference.
    expect(columns).toEqual({
      pipelineExecutionId: null,
      manifestId: null,
      manifestVersion: null,
    });
    expect(Object.keys(columns).sort()).toEqual([
      'manifestId',
      'manifestVersion',
      'pipelineExecutionId',
    ]);
  });

  it('nulls only the parts that are missing', () => {
    expect(rowProvenance({ pipelineExecutionId: 'exec-1' })).toEqual({
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
});
