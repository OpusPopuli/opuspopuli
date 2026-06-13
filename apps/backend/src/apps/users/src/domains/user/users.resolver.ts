import {
  Args,
  Context,
  Extensions,
  ID,
  Mutation,
  Query,
  Resolver,
  ResolveReference,
} from '@nestjs/graphql';

import { User } from './models/user.model';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserInputError } from '@nestjs/apollo';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { Public } from 'src/common/decorators/public.decorator';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { CURRENT_COMMITMENTS_VERSION } from './commitments.constants';

import { Role } from 'src/common/enums/role.enum';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Action } from 'src/common/enums/action.enum';
import { Permissions } from 'src/common/decorators/permissions.decorator';

@Resolver(() => User)
export class UsersResolver {
  constructor(
    // private caslPermissions: CaslPermissions,
    private usersService: UsersService,
  ) {}

  @Public()
  @Mutation(() => User)
  async createUser(
    @Args('createUserDto') createUserDto: CreateUserDto,
  ): Promise<User | null> {
    let createdUser: User | null;
    try {
      createdUser = await this.usersService.create(createUserDto);
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return createdUser;
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({
    action: Action.Update,
    subject: 'User',
    conditions: { id: '{{ id }}' },
  })
  async updateUser(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Args('updateUserDto') updateUserDto: UpdateUserDto,
  ): Promise<boolean> {
    let userUpdated: boolean;
    try {
      userUpdated = await this.usersService.update(id, updateUserDto);
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return userUpdated;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  deleteUser(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.usersService.delete(id);
  }

  @Query(() => [User])
  @Roles(Role.Admin)
  @Extensions({ complexity: 20 }) // List operation - higher complexity
  getUsers(): Promise<User[] | null> {
    return this.usersService.findAll();
  }

  @Query(() => User)
  @UseGuards(AuthGuard)
  @Permissions({
    action: Action.Read,
    subject: 'User',
    conditions: { id: '{{ id }}' },
  })
  getUser(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<User | null> {
    return this.usersService.findById(id);
  }

  @Public()
  @Query(() => User)
  findUser(@Args('email') email: string): Promise<User | null> {
    return this.usersService.findByEmail(email);
  }

  /**
   * Record the authenticated user's acknowledgement of the published
   * ethical commitments (#754). Rejects any `version` other than the
   * server's `CURRENT_COMMITMENTS_VERSION` so a stale client cannot
   * skip a re-prompt triggered by a version bump — see
   * `commitments.constants.ts` for the bump procedure.
   *
   * Returns the updated `User` so the Apollo cache picks up the new
   * `commitmentsAcknowledgedAt` / `commitmentsVersionAcknowledged`
   * fields without an extra round-trip.
   */
  @Mutation(() => User)
  @UseGuards(AuthGuard)
  async acknowledgeCommitments(
    @Args('version') version: string,
    @Context() context: GqlContext,
  ): Promise<User> {
    // Defensive cap — the equality check below makes this redundant
    // for the happy path, but a 20-char ceiling means we never run
    // string compare against an attacker-supplied megabyte payload.
    // The published version format is semver-ish (e.g. `1.0.0`) so
    // 20 chars is generous.
    if (typeof version !== 'string' || version.length > 20) {
      throw new UserInputError('Invalid commitments version.');
    }
    if (version !== CURRENT_COMMITMENTS_VERSION) {
      throw new UserInputError('Unsupported commitments version.');
    }
    const me = getUserFromContext(context);
    return this.usersService.acknowledgeCommitments(me.id, version);
  }

  @ResolveReference()
  resolveReference(reference: {
    __typename: string;
    id: string;
  }): Promise<User | null> {
    return this.usersService.findById(reference.id);
  }
}
