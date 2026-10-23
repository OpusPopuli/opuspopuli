import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';

/** Delete the key only if it still holds our token. */
const RELEASE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

/**
 * Extend the key if it holds our token; take it back if it lapsed and nobody
 * else holds it (a stall longer than the TTL). 0 only when another holder
 * has it.
 */
const RENEW = `
local holder = redis.call("GET", KEYS[1])
if holder == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if not holder then
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
  return 1
end
return 0`;

export interface HeldLock {
  release(): Promise<void>;
}

/**
 * One running sync per data type, across every worker process (S2,
 * `docs/plans/S2-per-type-sync-jobs.md`).
 *
 * Two syncs of one type are unsafe: two bills prunes from different discovery
 * snapshots delete each other's new bills, the co-author/committee/vote
 * linkers delete-then-create without a transaction, two civics glossary
 * prunes drop terms the other has not finished writing. Concurrency 1 was
 * what prevented all of it; with concurrency 2 this does.
 *
 * Keyed by type alone, not region and type: a job with no `regionId` syncs
 * every region's plugins of that type, so a narrower key would let it run
 * beside a scoped one.
 *
 * A TTL'd key renewed while the sync runs: a crashed holder's lock expires
 * within `ttlMs`, a live one's never does. The TTL should match the job's own
 * BullMQ lock — shorter, a stall the job survives would free the type for a
 * second sync. Compare-and-delete on release, so a holder whose lock lapsed
 * cannot delete the lock the next holder took.
 *
 * Its own keyspace, not the queue's, so a queue `obliterate` or key scan does
 * not treat it as job data.
 */
export class DataTypeLock {
  private readonly logger = new Logger(DataTypeLock.name);

  constructor(
    private readonly redis: IORedis,
    private readonly prefix: string,
    private readonly ttlMs: number,
  ) {}

  /** The lock for `dataType`, or null when another sync holds it. */
  async acquire(dataType: string): Promise<HeldLock | null> {
    const key = `${this.prefix}:locks:region-sync:${dataType}`;
    const token = randomUUID();
    const taken = await this.redis.set(key, token, 'PX', this.ttlMs, 'NX');
    if (taken !== 'OK') return null;

    const renew = setInterval(() => {
      this.redis
        .eval(RENEW, 1, key, token, String(this.ttlMs))
        .then((kept) => {
          if (kept !== 1) {
            this.logger.warn(
              `Lost the ${dataType} sync lock — another sync of the same ` +
                'type may now start beside this one',
            );
          }
        })
        .catch(() => undefined); // retried on the next tick
    }, this.ttlMs / 3);
    renew.unref();

    return {
      release: async () => {
        clearInterval(renew);
        await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
      },
    };
  }
}
