import { ArgsType, Field } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayMinSize, IsEnum, Matches } from 'class-validator';
import { JurisdictionTypeGQL } from '../models/jurisdiction.model';

@ArgsType()
export class RegionShapesArgs {
  @Field(() => [JurisdictionTypeGQL], {
    description:
      'Layers to draw together, e.g. [COUNTY] or [COUNTY, STATE_SENATE_DISTRICT].',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsEnum(JurisdictionTypeGQL, { each: true })
  types!: JurisdictionTypeGQL[];
}

@ArgsType()
export class CountyShapesArgs {
  @Field(() => String, { description: "The county's FIPS code." })
  // jurisdictions.fips_code is VARCHAR(20); anything else names no county.
  @Matches(/^[A-Za-z0-9-]{1,20}$/)
  fips!: string;
}
