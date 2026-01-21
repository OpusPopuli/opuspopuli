import { Field, ID, ObjectType } from '@nestjs/graphql';
import { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';

@ObjectType()
export class UserConsentModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field(() => ConsentType)
  consentType!: ConsentType;

  @Field(() => ConsentStatus)
  status!: ConsentStatus;

  @Field({ nullable: true })
  documentVersion?: string;

  @Field({ nullable: true })
  documentUrl?: string;

  @Field({ nullable: true })
  userAgent?: string;

  @Field({ nullable: true })
  collectionMethod?: string;

  @Field({ nullable: true })
  collectionContext?: string;

  @Field({ nullable: true })
  grantedAt?: Date;

  @Field({ nullable: true })
  deniedAt?: Date;

  @Field({ nullable: true })
  withdrawnAt?: Date;

  @Field({ nullable: true })
  expiresAt?: Date;

  @Field({ nullable: true })
  consentText?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
