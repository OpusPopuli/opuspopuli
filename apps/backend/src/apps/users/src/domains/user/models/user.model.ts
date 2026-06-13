import { Directive, Field, ID, ObjectType } from '@nestjs/graphql';
import { User as DbUser } from '@opuspopuli/relationaldb-provider';

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
   * Public ethical commitments acknowledgement (#754). NULL until the
   * user completes the onboarding ack step or accepts a version bump
   * via the in-app re-acknowledgement prompt.
   */
  @Field({ nullable: true })
  commitmentsAcknowledgedAt?: Date;

  /**
   * Which COMMITMENTS_VERSION the user agreed to. Compared against the
   * current published version to decide whether to re-prompt.
   */
  @Field({ nullable: true })
  commitmentsVersionAcknowledged?: string;

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
    user.commitmentsAcknowledgedAt =
      dbUser.commitmentsAcknowledgedAt ?? undefined;
    user.commitmentsVersionAcknowledged =
      dbUser.commitmentsVersionAcknowledged ?? undefined;
    return user;
  }

  /**
   * Converts an array of database Users to GraphQL User models
   */
  static fromDbArray(dbUsers: DbUser[]): User[] {
    return dbUsers.map((u) => User.fromDb(u));
  }
}
