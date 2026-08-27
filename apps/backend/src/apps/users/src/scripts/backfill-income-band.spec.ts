import { Logger } from '@nestjs/common';
import {
  decideAndApply,
  processRow,
  type Counters,
} from './backfill-income-band.logic';
import type { SensitiveProfileService } from '../domains/personalization/sensitive-profile.service';

/**
 * Row-level resilience for the income backfill (#1071).
 *
 * The encryption round trip itself is covered by the integration spec against a
 * real database. What is covered here is what happens when a row FAILS — which
 * needs a service that throws on demand, and no database.
 */

const emptyCounters = (): Counters => ({
  scanned: 0,
  written: 0,
  skippedAlreadySet: 0,
  skippedNoFieldsMode: 0,
  skippedUnmappable: 0,
  failed: 0,
});

function stubSensitive(
  overrides: Partial<{
    getState: jest.Mock;
    updatePayload: jest.Mock;
  }> = {},
) {
  return {
    getState:
      overrides.getState ??
      jest.fn().mockResolvedValue({
        noFieldsMode: false,
        payload: null,
      }),
    updatePayload:
      overrides.updatePayload ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as SensitiveProfileService;
}

describe('backfill-income-band row resilience', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  });

  /**
   * The known cause: EncryptionService.decrypt refuses a row whose keyVersion
   * is not the current one ("Key-rotation read path is a planned follow-up").
   * Before this handling, one such row aborted the entire run and left the
   * table half-migrated.
   */
  it('counts a decrypt failure and keeps going instead of throwing', async () => {
    const sensitive = stubSensitive({
      getState: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Cannot decrypt SensitiveProfile written with keyVersion=2',
          ),
        ),
    });
    const counters = emptyCounters();
    const failed: string[] = [];

    await expect(
      processRow(
        { userId: 'user-1', incomeRange: '50k_75k' },
        sensitive,
        false,
        counters,
        failed,
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(counters.failed).toBe(1);
    expect(counters.written).toBe(0);
    expect(failed).toEqual(['user-1']);
  });

  it('records the failed user id but never the value', async () => {
    const sensitive = stubSensitive({
      getState: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const counters = emptyCounters();
    const failed: string[] = [];

    await processRow(
      { userId: 'user-2', incomeRange: 'over_200k' },
      sensitive,
      false,
      counters,
      failed,
      logger,
    );

    const logged = (logger.error as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('user-2');
    // The band is CCPA/CPRA personal information — an error string is not a
    // place for it.
    expect(logged).not.toContain('over_200k');
  });

  it('a failing row does not stop the rows after it', async () => {
    const getState = jest
      .fn()
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValue({ noFieldsMode: false, payload: null });
    const sensitive = stubSensitive({ getState });
    const counters = emptyCounters();
    const failed: string[] = [];

    for (const userId of ['a', 'b', 'c']) {
      await processRow(
        { userId, incomeRange: 'under_25k' },
        sensitive,
        false,
        counters,
        failed,
        logger,
      );
    }

    expect(counters.failed).toBe(1);
    expect(counters.written).toBe(2);
    expect(failed).toEqual(['a']);
  });

  it('does not write on the dry-run path', async () => {
    const updatePayload = jest.fn();
    const sensitive = stubSensitive({ updatePayload });
    const counters = emptyCounters();

    await processRow(
      { userId: 'user-3', incomeRange: '75k_100k' },
      sensitive,
      true,
      counters,
      [],
      logger,
    );

    expect(updatePayload).not.toHaveBeenCalled();
    expect(counters.written).toBe(1);
  });

  it('propagates the error out of decideAndApply so processRow can count it', async () => {
    const sensitive = stubSensitive({
      getState: jest.fn().mockRejectedValue(new Error('nope')),
    });

    await expect(
      decideAndApply('user-4', 'under_25k', sensitive),
    ).rejects.toThrow('nope');
  });
});
