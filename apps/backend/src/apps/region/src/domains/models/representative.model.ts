import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * A physical office location (Capitol or district)
 */
@ObjectType()
export class OfficeModel {
  @Field()
  name!: string;

  @Field({ nullable: true })
  address?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  fax?: string;
}

/**
 * Contact information for a representative
 */
@ObjectType()
export class ContactInfoModel {
  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  website?: string;

  @Field(() => [OfficeModel], { nullable: true })
  offices?: OfficeModel[];
}

/**
 * Per-sentence attribution for an AI-generated biography.
 */
@ObjectType()
export class BioClaimModel {
  @Field()
  sentence!: string;

  @Field()
  origin!: string;

  @Field({ nullable: true })
  sourceField?: string;

  @Field({ nullable: true })
  sourceHint?: string;

  @Field({ nullable: true })
  confidence?: string;
}

/**
 * A legislative committee assignment
 */
@ObjectType()
export class CommitteeAssignmentModel {
  @Field()
  name!: string;

  @Field({ nullable: true })
  role?: string;

  @Field({ nullable: true })
  url?: string;
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

  @Field(() => [CommitteeAssignmentModel], { nullable: true })
  committees?: CommitteeAssignmentModel[];

  @Field({ nullable: true })
  committeesSummary?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field({ nullable: true })
  bioSource?: string;

  @Field(() => [BioClaimModel], { nullable: true })
  bioClaims?: BioClaimModel[];

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
