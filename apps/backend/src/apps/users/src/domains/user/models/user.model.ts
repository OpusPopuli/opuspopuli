import { Directive, Field, ID, ObjectType } from '@nestjs/graphql';
import { User as DbUser } from '@qckstrt/relationaldb-provider';

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
   * Converts a database User to GraphQL User model
   * Handles null -> undefined conversion for optional fields
   */
  static fromDb(dbUser: DbUser): User {
    const user = new User();
    user.id = dbUser.id;
    user.email = dbUser.email;
    user.firstName = dbUser.firstName ?? undefined;
    user.lastName = dbUser.lastName ?? undefined;
    user.created = dbUser.created;
    user.updated = dbUser.updated;
    return user;
  }

  /**
   * Converts an array of database Users to GraphQL User models
   */
  static fromDbArray(dbUsers: DbUser[]): User[] {
    return dbUsers.map((u) => User.fromDb(u));
  }
}
