import {
  Resolver,
  Query,
  Mutation,
  Args,
  Context,
  Int,
  ID,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import {
  GqlContext,
  getUserFromContext,
  getSessionTokenFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { ActivityService } from './activity.service';
import {
  ActivityLogPage,
  ActivityLogFilters,
  SessionInfo,
  SessionsPage,
  ActivitySummary,
} from './dto/activity.dto';

@Resolver()
@UseGuards(AuthGuard)
export class ActivityResolver {
  constructor(private readonly activityService: ActivityService) {}

  // ============================================
  // Activity Log Queries
  // ============================================

  @Query(() => ActivityLogPage, { name: 'myActivityLog' })
  async getMyActivityLog(
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('filters', { nullable: true }) filters: ActivityLogFilters,
    @Context() context: GqlContext,
  ): Promise<ActivityLogPage> {
    const user = getUserFromContext(context);
    return this.activityService.getActivityLog(user.id, limit, offset, filters);
  }

  @Query(() => ActivitySummary, { name: 'myActivitySummary' })
  async getMyActivitySummary(
    @Context() context: GqlContext,
  ): Promise<ActivitySummary> {
    const user = getUserFromContext(context);
    return this.activityService.getActivitySummary(user.id);
  }

  // ============================================
  // Session Queries & Mutations
  // ============================================

  @Query(() => SessionsPage, { name: 'mySessions' })
  async getMySessions(
    @Args('includeRevoked', { type: () => Boolean, defaultValue: false })
    includeRevoked: boolean,
    @Context() context: GqlContext,
  ): Promise<SessionsPage> {
    const user = getUserFromContext(context);
    const currentToken = getSessionTokenFromContext(context);
    return this.activityService.getSessions(
      user.id,
      currentToken,
      includeRevoked,
    );
  }

  @Query(() => SessionInfo, { nullable: true, name: 'mySession' })
  async getMySession(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<SessionInfo | null> {
    const user = getUserFromContext(context);
    const currentToken = getSessionTokenFromContext(context);
    return this.activityService.getSession(user.id, id, currentToken);
  }

  @Mutation(() => Boolean)
  async revokeSession(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.activityService.revokeSession(user.id, id, 'user_logout');
  }

  @Mutation(() => Int, { description: 'Revoke all sessions except current' })
  async revokeAllOtherSessions(
    @Context() context: GqlContext,
  ): Promise<number> {
    const user = getUserFromContext(context);
    const currentToken = getSessionTokenFromContext(context);
    return this.activityService.revokeAllSessions(
      user.id,
      currentToken,
      'user_logout_all',
    );
  }
}
