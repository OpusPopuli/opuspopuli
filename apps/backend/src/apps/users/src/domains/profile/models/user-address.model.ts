import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AddressType } from 'src/common/enums/address.enum';

// Re-export AddressType for GraphQL
registerEnumType(AddressType, {
  name: 'AddressType',
  description: 'Type of address',
});

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

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
