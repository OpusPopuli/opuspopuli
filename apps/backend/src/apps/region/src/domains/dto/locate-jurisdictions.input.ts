import { ArgsType, Field, Float, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Inputs for finding a visitor's districts without an account (#1456).
 *
 * These carry CCPA personal information: a street address, or a precise
 * location, which CPRA treats as sensitive. They are validated here, at the
 * edge, so an oversized or malformed payload is refused before anything
 * else sees it. The resolver is `@SkipAudit` and logs none of it.
 */

/** Most ids one restore may ask for; a visitor has a few dozen districts. */
export const MAX_JURISDICTION_IDS = 50;

@InputType()
export class GeoPointInput {
  @Field(() => Float)
  @IsLatitude()
  lat!: number;

  @Field(() => Float)
  @IsLongitude()
  lng!: number;
}

@InputType()
export class AddressLookupInput {
  @Field()
  @IsNotEmpty()
  @MaxLength(200)
  line1!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @Field()
  @Matches(/^[A-Za-z]{2}$/)
  state!: string;

  @Field()
  @Matches(/^\d{5}(-\d{4})?$/)
  postalCode!: string;
}

/** Exactly one of `point` or `address`; the service refuses both or neither. */
@InputType()
export class LocateJurisdictionsInput {
  @Field(() => GeoPointInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointInput)
  point?: GeoPointInput;

  @Field(() => AddressLookupInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressLookupInput)
  address?: AddressLookupInput;
}

@ArgsType()
export class JurisdictionsByIdsArgs {
  @Field(() => [ID])
  @ArrayMaxSize(MAX_JURISDICTION_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];
}
