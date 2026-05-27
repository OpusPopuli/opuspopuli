import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

export interface RecordEventInput {
  verb: string;
  objectType: string;
  objectId: string;
  context?: Record<string, unknown>;
}

/**
 * Append-only behavioral event log (doc §4.12). The service exposes
 * `record` for writes, `listForUser` for the model-of-me page (slice C),
 * and `resetForUser` for the user-initiated "wipe behavioral history"
 * action.
 *
 * Intentionally no `update` method — events are immutable once written.
 * Validation of `verb` and `objectType` is left to the resolver/DTO
 * layer so this service stays a thin DB wrapper.
 */
@Injectable()
export class UserEventService {
  constructor(private readonly db: DbService) {}

  async record(
    userId: string,
    input: RecordEventInput,
  ): Promise<Prisma.UserEventGetPayload<true>> {
    return this.db.userEvent.create({
      data: {
        user: { connect: { id: userId } },
        verb: input.verb,
        objectType: input.objectType,
        objectId: input.objectId,
        // Only pass `context` when provided. Prisma JSON columns reject
        // explicit `null` from the typed API; SQL NULL is the default
        // when the field is omitted.
        ...(input.context !== undefined && {
          context: input.context as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async listForUser(
    userId: string,
    opts: { take?: number; objectType?: string } = {},
  ): Promise<Prisma.UserEventGetPayload<true>[]> {
    return this.db.userEvent.findMany({
      where: {
        userId,
        ...(opts.objectType && { objectType: opts.objectType }),
      },
      orderBy: { occurredAt: 'desc' },
      take: opts.take ?? 100,
    });
  }

  /**
   * User-initiated reset. Wipes the entire event history for one user
   * in a single query. Used by the "reset behavioral history" control
   * on the model-of-me page. Returns the number of events removed.
   */
  async resetForUser(userId: string): Promise<number> {
    const { count } = await this.db.userEvent.deleteMany({
      where: { userId },
    });
    return count;
  }
}
