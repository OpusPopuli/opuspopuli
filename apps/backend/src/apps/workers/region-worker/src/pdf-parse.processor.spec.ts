import { pdfParserKeyFor } from '@opuspopuli/extraction-provider';
import { createTesseractOcrServiceFromEnv } from '@opuspopuli/ocr-provider';
import { PdfParseProcessor, type PdfParsePool } from './pdf-parse.processor';
import type { SourceVersionService } from 'src/apps/region/src/domains/source-version.service';

/** The key this process computes — what a matching request carries. */
const KEY = pdfParserKeyFor(
  createTesseractOcrServiceFromEnv().getProviderInfo(),
);

class TestProcessor extends PdfParseProcessor {
  constructor(
    sourceVersions: SourceVersionService,
    private readonly fakePool: PdfParsePool,
  ) {
    super(sourceVersions, {} as never, { get: () => undefined } as never);
  }
  protected createPool(): PdfParsePool {
    return this.fakePool;
  }
  invoke(data: { sourceVersionId: string; parserKey: string }) {
    return this.run(data);
  }
}

function build(
  opts: {
    recorded?: string;
    artifact?: {
      content?: Uint8Array;
      parsedText?: string | null;
      parserVersion?: string | null;
    } | null;
    parse?: { text: string; complete: boolean };
    stored?: boolean;
  } = {},
) {
  const sv = {
    getForParse: jest.fn().mockResolvedValue(
      opts.artifact === null
        ? null
        : {
            content: Uint8Array.from([37, 80, 68, 70]),
            parsedText: opts.recorded ?? null,
            parserVersion: opts.recorded === undefined ? null : KEY,
            ...opts.artifact,
          },
    ),
    attachParsedText: jest.fn().mockResolvedValue(opts.stored ?? true),
  };
  const pool = {
    run: jest
      .fn()
      .mockResolvedValue(opts.parse ?? { text: 'the text', complete: true }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const proc = new TestProcessor(sv as unknown as SourceVersionService, pool);
  return { proc, sv, pool };
}

describe('PdfParseProcessor', () => {
  it('parses on the pool and records a complete parse under the key', async () => {
    const { proc, sv, pool } = build();

    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('parsed');

    const [payload, transfer] = pool.run.mock.calls[0];
    expect(new Uint8Array(payload.bytes)).toEqual(
      Uint8Array.from([37, 80, 68, 70]),
    );
    expect(transfer).toEqual([payload.bytes]);
    expect(sv.attachParsedText).toHaveBeenCalledWith('sv-1', KEY, 'the text');
  });

  it('does nothing on a key it would not produce — the requester parses itself', async () => {
    const { proc, sv, pool } = build();
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: 'pdf-v3+elsewhere' }),
    ).resolves.toBe('key_mismatch');
    expect(sv.getForParse).not.toHaveBeenCalled();
    expect(pool.run).not.toHaveBeenCalled();
  });

  it('reports reused when the parse is already recorded — even an empty one', async () => {
    const { proc, pool } = build({ recorded: '' });
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('reused');
    expect(pool.run).not.toHaveBeenCalled();
  });

  it('re-parses a parse recorded under another key', async () => {
    const { proc, sv, pool } = build({
      artifact: { parsedText: 'old', parserVersion: 'pdf-extractor-0+old' },
    });
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('parsed');
    expect(pool.run).toHaveBeenCalled();
    expect(sv.attachParsedText).toHaveBeenCalledWith('sv-1', KEY, 'the text');
  });

  it('warns about a key mismatch once per key, not once per job', async () => {
    const { proc } = build();
    const warn = jest
      .spyOn(
        (proc as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    for (let i = 0; i < 3; i++) {
      await proc.invoke({ sourceVersionId: `sv-${i}`, parserKey: 'other' });
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports missing for an artifact that is not archived', async () => {
    const { proc } = build({ artifact: null });
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('missing');
  });

  it('records nothing from an incomplete parse', async () => {
    const { proc, sv } = build({ parse: { text: 'partial', complete: false } });
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('incomplete');
    expect(sv.attachParsedText).not.toHaveBeenCalled();
  });

  it('reports incomplete when the parse is too large to store', async () => {
    const { proc } = build({ stored: false });
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).resolves.toBe('incomplete');
  });

  it('lets a thread failure fail the job, so the queue retries it', async () => {
    const { proc, pool } = build();
    pool.run.mockRejectedValue(new Error('thread timed out'));
    await expect(
      proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY }),
    ).rejects.toThrow('timed out');
  });

  it('creates the pool on the first job and closes it on shutdown', async () => {
    const { proc, pool } = build();
    await proc.onModuleDestroy();
    expect(pool.close).not.toHaveBeenCalled();

    await proc.invoke({ sourceVersionId: 'sv-1', parserKey: KEY });
    await proc.onModuleDestroy();
    expect(pool.close).toHaveBeenCalledTimes(1);
  });
});
