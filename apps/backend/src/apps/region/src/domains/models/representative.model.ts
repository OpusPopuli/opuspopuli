import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * Contact information for a representative
 */
@ObjectType()
export class ContactInfoModel {
  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  address?: string;

  @Field({ nullable: true })
  website?: string;
}

/**
 * Representative GraphQL model
 */
@ObjectType()
export class RepresentativeModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  name!: string;

  @Field()
  chamber!: string;

  @Field()
  district!: string;

  @Field({ nullable: true })
  party?: string;

  @Field({ nullable: true })
  photoUrl?: string;

  @Field(() => ContactInfoModel, { nullable: true })
  contactInfo?: ContactInfoModel;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated representatives response
 */
@ObjectType()
export class PaginatedRepresentatives {
  @Field(() => [RepresentativeModel])
  items!: RepresentativeModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
