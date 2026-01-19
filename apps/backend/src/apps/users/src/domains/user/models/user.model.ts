import { Directive, Field, ID, ObjectType } from '@nestjs/graphql';
import { User as PrismaUser } from '@prisma/client';

import { IUser } from 'src/interfaces/user.interface';

@ObjectType()
@Directive('@key(fields: "id")')
export class User implements IUser {
  @Field(() => ID)
  public id!: string;

  @Field()
  public email!: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  public created!: Date;

  @Field({ nullable: true })
  public updated!: Date;

  /**
   * Converts a Prisma User to GraphQL User model
   * Handles null -> undefined conversion for optional fields
   */
  static fromPrisma(prismaUser: PrismaUser): User {
    const user = new User();
    user.id = prismaUser.id;
    user.email = prismaUser.email;
    user.firstName = prismaUser.firstName ?? undefined;
    user.lastName = prismaUser.lastName ?? undefined;
    user.created = prismaUser.created;
    user.updated = prismaUser.updated;
    return user;
  }

  /**
   * Converts an array of Prisma Users to GraphQL User models
   */
  static fromPrismaArray(prismaUsers: PrismaUser[]): User[] {
    return prismaUsers.map((u) => User.fromPrisma(u));
  }
}
