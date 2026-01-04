import {
  Args,
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

  @Query(() => User)
  findUser(@Args('email') email: string): Promise<User | null> {
    return this.usersService.findByEmail(email);
  }

  @ResolveReference()
  resolveReference(reference: {
    __typename: string;
    id: string;
  }): Promise<User | null> {
    return this.usersService.findById(reference.id);
  }
}
