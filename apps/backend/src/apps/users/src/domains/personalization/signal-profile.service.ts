import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

/**
 * CRUD for SignalProfile (T1 + T2 declared signals). One row per user;
 * upsert semantics so the first call creates and subsequent calls update.
 * All input fields are optional — only the keys actually provided in the
 * input object are written.
 *
 * The frontend onboarding flow (issue #742-B follow-up) populates this
 * progressively; the ranking pipeline (issue #743) reads from here at
 * federation time. See docs/architecture/personalized-relevance.md.
 */
@Injectable()
export class SignalProfileService {
  constructor(private readonly db: DbService) {}

  async getByUserId(
    userId: string,
  ): Promise<Prisma.SignalProfileGetPayload<true> | null> {
    return this.db.signalProfile.findUnique({ where: { userId } });
  }

  /**
   * Upsert: create if missing, partial update otherwise. Only keys
   * present in `input` are written — undefined keys leave the existing
   * value untouched. Setting a key to `null` explicitly clears it (for
   * scalars) or to `[]` clears an array.
   */
  async upsert(
    userId: string,
    input: Prisma.SignalProfileUpdateInput,
  ): Promise<Prisma.SignalProfileGetPayload<true>> {
    return this.db.signalProfile.upsert({
      where: { userId },
      create: {
        ...(input as Prisma.SignalProfileCreateInput),
        // user.connect comes last so it deterministically wins over any
        // stray `user` field a future caller might include in `input`.
        // At runtime today the input DTO never contains `user`.
        user: { connect: { id: userId } },
      },
      update: input,
    });
  }
}
