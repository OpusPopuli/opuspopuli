import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UserProfileModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field({ nullable: true })
  dateOfBirth?: Date;

  @Field({ nullable: true })
  phoneNumber?: string;

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  avatarStorageKey?: string;

  @Field({ nullable: true })
  language?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
