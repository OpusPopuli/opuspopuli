import { UseGuards } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import { UserEventService } from './user-event.service';
import { UpdateSignalProfileDto } from './dto/update-signal-profile.dto';
import { UpdateSensitiveProfileDto } from './dto/update-sensitive-profile.dto';
import { RecordEventDto } from './dto/record-event.dto';
import { SignalProfileModel } from './models/signal-profile.model';
import { SensitiveProfileModel } from './models/sensitive-profile.model';
import { UserEventModel } from './models/user-event.model';
import { type SensitiveProfilePayload } from './dto/sensitive-profile-payload';

/**
 * GraphQL resolver for the personalization layer (#742). All operations
 * are gated by AuthGuard at the class level — the resolver extracts the
 * authenticated user from context for every mutation.
 *
 * The SensitiveProfile mutation honors the no-fields-mode toggle: when
 * on, write calls are silently no-op'd by the service and reads return
 * a model with `noFieldsMode: true` and every other field null.
 */
@Resolver()
@UseGuards(AuthGuard)
export class PersonalizationResolver {
  constructor(
    private readonly signalProfile: SignalProfileService,
    private readonly sensitiveProfile: SensitiveProfileService,
    private readonly userEvent: UserEventService,
  ) {}

  // ============================================
  // SignalProfile (T1 + T2)
  // ============================================

  @Query(() => SignalProfileModel, { nullable: true, name: 'mySignalProfile' })
  async getMySignalProfile(
    @Context() context: GqlContext,
  ): Promise<SignalProfileModel | null> {
    const user = getUserFromContext(context);
    const row = await this.signalProfile.getByUserId(user.id);
    return row as SignalProfileModel | null;
  }

  @Mutation(() => SignalProfileModel)
  async updateMySignalProfile(
    @Args('input') input: UpdateSignalProfileDto,
    @Context() context: GqlContext,
  ): Promise<SignalProfileModel> {
    const user = getUserFromContext(context);
    const row = await this.signalProfile.upsert(user.id, input);
    return row as unknown as SignalProfileModel;
  }

  // ============================================
  // SensitiveProfile (T3, encrypted at rest)
  // ============================================

  @Query(() => SensitiveProfileModel, { name: 'mySensitiveProfile' })
  async getMySensitiveProfile(
    @Context() context: GqlContext,
  ): Promise<SensitiveProfileModel> {
    const user = getUserFromContext(context);
    const { noFieldsMode, payload } = await this.sensitiveProfile.getState(
      user.id,
    );
    return { noFieldsMode, ...(payload ?? {}) };
  }

  @Mutation(() => SensitiveProfileModel)
  async updateMySensitiveProfile(
    @Args('input') input: UpdateSensitiveProfileDto,
    @Context() context: GqlContext,
  ): Promise<SensitiveProfileModel> {
    const user = getUserFromContext(context);
    const { noFieldsMode, payload: existing } =
      await this.sensitiveProfile.getState(user.id);

    if (noFieldsMode) {
      // Non-null writes are blocked by the service when noFieldsMode is
      // on; short-circuit here for a clear response shape.
      return { noFieldsMode: true };
    }

    // Merge: undefined keys leave existing untouched; explicit values
    // overwrite. Arrays are replaced wholesale when provided.
    const merged: SensitiveProfilePayload = { ...(existing ?? {}) };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }

    await this.sensitiveProfile.updatePayload(user.id, merged);
    return { noFieldsMode: false, ...merged };
  }

  @Mutation(() => SensitiveProfileModel)
  async setMyNoFieldsMode(
    @Args('on') on: boolean,
    @Context() context: GqlContext,
  ): Promise<SensitiveProfileModel> {
    const user = getUserFromContext(context);
    await this.sensitiveProfile.setNoFieldsMode(user.id, on);
    const { noFieldsMode, payload } = await this.sensitiveProfile.getState(
      user.id,
    );
    return { noFieldsMode, ...(payload ?? {}) };
  }

  /**
   * User-initiated full clear of the encrypted payload while keeping the
   * no-fields-mode flag. The service honors this even when noFieldsMode
   * is on — explicit clear is the safest privacy path.
   */
  @Mutation(() => SensitiveProfileModel)
  async clearMySensitiveProfile(
    @Context() context: GqlContext,
  ): Promise<SensitiveProfileModel> {
    const user = getUserFromContext(context);
    await this.sensitiveProfile.updatePayload(user.id, null);
    const noFieldsMode = await this.sensitiveProfile.getNoFieldsMode(user.id);
    return { noFieldsMode };
  }

  // ============================================
  // UserEvent (append-only behavioral log)
  // ============================================

  @Mutation(() => UserEventModel)
  async recordEvent(
    @Args('input') input: RecordEventDto,
    @Context() context: GqlContext,
  ): Promise<UserEventModel> {
    const user = getUserFromContext(context);
    const row = await this.userEvent.record(user.id, input);
    return row as unknown as UserEventModel;
  }

  @Query(() => [UserEventModel], { name: 'myEvents' })
  async getMyEvents(
    @Context() context: GqlContext,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('objectType', { nullable: true }) objectType?: string,
  ): Promise<UserEventModel[]> {
    const user = getUserFromContext(context);
    const rows = await this.userEvent.listForUser(user.id, {
      take: take ?? undefined,
      objectType: objectType ?? undefined,
    });
    return rows as unknown as UserEventModel[];
  }

  @Mutation(() => Int)
  async resetMyEvents(@Context() context: GqlContext): Promise<number> {
    const user = getUserFromContext(context);
    return this.userEvent.resetForUser(user.id);
  }
}
