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
  middleName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  preferredName?: string;

  @Field({ nullable: true })
  dateOfBirth?: Date;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  phoneVerifiedAt?: Date;

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  locale?: string;

  @Field({ nullable: true })
  preferredLanguage?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  avatarStorageKey?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field()
  isPublic!: boolean;

  // The civic and demographic fields were removed here in #1071 — they
  // duplicated Your Model, and nothing but the completion percentage read
  // them. Columns are dropped in a follow-up, after this deploys.

  /**
   * First-run onboarding completion (#758). NULL until the user finishes
   * or skips onboarding. Server-side source of truth so a returning user
   * on a new device isn't re-prompted — the frontend reads this via the
   * `myProfile` query and falls back to localStorage only as a cache.
   */
  @Field({ nullable: true })
  onboardingCompletedAt?: Date;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
