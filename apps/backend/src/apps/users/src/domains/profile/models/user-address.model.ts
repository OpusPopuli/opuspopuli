import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AddressType } from 'src/common/enums/address.enum';

// Re-export AddressType for GraphQL
registerEnumType(AddressType, {
  name: 'AddressType',
  description: 'Type of address',
});

// Civic-data resolution outcome (#802). Lets the frontend distinguish
// "civic data still being resolved" / "resolution found no matches" /
// "resolution errored" from "fully resolved", so users see a meaningful
// state instead of a silently-empty representatives list.
export enum CivicResolutionStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
  NO_MATCH = 'no_match',
  FAILED = 'failed',
}
registerEnumType(CivicResolutionStatus, {
  name: 'CivicResolutionStatus',
  description: 'Outcome of jurisdictional resolution for an address',
});

// Keep in lockstep with the VARCHAR(500) column width declared in
// 20260603020000_civic_resolution_status/migration.sql. If you bump one,
// bump the other (and the migration may need to be replaced with an ALTER).
export const MAX_CIVIC_ERROR_LENGTH = 500;

@ObjectType()
export class UserAddressModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field(() => AddressType)
  addressType!: AddressType;

  @Field()
  isPrimary!: boolean;

  @Field({ nullable: true })
  label?: string;

  @Field()
  addressLine1!: string;

  @Field({ nullable: true })
  addressLine2?: string;

  @Field()
  city!: string;

  @Field()
  state!: string;

  @Field()
  postalCode!: string;

  @Field()
  country!: string;

  @Field({ nullable: true })
  latitude?: number;

  @Field({ nullable: true })
  longitude?: number;

  @Field({ nullable: true })
  formattedAddress?: string;

  @Field({ nullable: true })
  placeId?: string;

  @Field({ nullable: true })
  congressionalDistrict?: string;

  @Field({ nullable: true })
  stateSenatorialDistrict?: string;

  @Field({ nullable: true })
  stateAssemblyDistrict?: string;

  @Field({ nullable: true })
  county?: string;

  @Field({ nullable: true })
  municipality?: string;

  @Field({ nullable: true })
  schoolDistrict?: string;

  @Field({ nullable: true })
  precinctId?: string;

  @Field({ nullable: true })
  pollingPlace?: string;

  @Field()
  isVerified!: boolean;

  @Field(() => CivicResolutionStatus)
  civicResolutionStatus!: CivicResolutionStatus;

  @Field({ nullable: true })
  civicResolutionError?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
