import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum JurisdictionTypeGQL {
  STATE = 'STATE',
  CONGRESSIONAL_DISTRICT = 'CONGRESSIONAL_DISTRICT',
  STATE_SENATE_DISTRICT = 'STATE_SENATE_DISTRICT',
  STATE_ASSEMBLY_DISTRICT = 'STATE_ASSEMBLY_DISTRICT',
  COUNTY = 'COUNTY',
  CITY = 'CITY',
  SCHOOL_DISTRICT_UNIFIED = 'SCHOOL_DISTRICT_UNIFIED',
  SCHOOL_DISTRICT_ELEMENTARY = 'SCHOOL_DISTRICT_ELEMENTARY',
  SCHOOL_DISTRICT_HIGH = 'SCHOOL_DISTRICT_HIGH',
  COMMUNITY_COLLEGE_DISTRICT = 'COMMUNITY_COLLEGE_DISTRICT',
  WATER_DISTRICT = 'WATER_DISTRICT',
  FIRE_DISTRICT = 'FIRE_DISTRICT',
  TRANSIT_DISTRICT = 'TRANSIT_DISTRICT',
  SPECIAL_DISTRICT = 'SPECIAL_DISTRICT',
  COUNTY_SUPERVISOR_DISTRICT = 'COUNTY_SUPERVISOR_DISTRICT',
}

export enum JurisdictionLevelGQL {
  FEDERAL = 'FEDERAL',
  STATE = 'STATE',
  COUNTY = 'COUNTY',
  MUNICIPAL = 'MUNICIPAL',
  DISTRICT = 'DISTRICT',
}

registerEnumType(JurisdictionTypeGQL, {
  name: 'JurisdictionType',
});

registerEnumType(JurisdictionLevelGQL, {
  name: 'JurisdictionLevel',
});

@ObjectType()
export class JurisdictionModel {
  @Field(() => ID)
  id!: string;

  @Field({ nullable: true })
  fipsCode?: string;

  @Field({ nullable: true })
  ocdId?: string;

  @Field()
  name!: string;

  @Field(() => JurisdictionTypeGQL)
  type!: JurisdictionTypeGQL;

  @Field(() => JurisdictionLevelGQL)
  level!: JurisdictionLevelGQL;

  @Field()
  stateCode!: string;

  @Field(() => JurisdictionModel, { nullable: true })
  parent?: JurisdictionModel;
}

@ObjectType()
export class UserJurisdictionModel {
  @Field()
  resolvedBy!: string;

  @Field()
  resolvedAt!: Date;

  @Field(() => JurisdictionModel)
  jurisdiction!: JurisdictionModel;
}
