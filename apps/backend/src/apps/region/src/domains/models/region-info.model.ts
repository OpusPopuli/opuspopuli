import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';

// ── Civics GQL types ─────────────────────────────────────────────────────────

@ObjectType('CivicText')
export class CivicTextModel {
  @Field()
  verbatim!: string;

  @Field()
  plainLanguage!: string;

  @Field()
  sourceUrl!: string;
}

@ObjectType('CivicsChamber')
export class ChamberModel {
  @Field()
  name!: string;

  @Field()
  abbreviation!: string;

  @Field()
  size!: number;

  @Field()
  termYears!: number;

  @Field(() => [String])
  leadershipRoles!: string[];

  @Field(() => CivicTextModel)
  description!: CivicTextModel;
}

@ObjectType('CitizenAction')
export class CitizenActionModel {
  @Field()
  verb!: string;

  @Field(() => CivicTextModel)
  label!: CivicTextModel;

  @Field({ nullable: true })
  url?: string;

  @Field()
  urgency!: string;
}

@ObjectType('CivicsLifecycleStage')
export class LifecycleStageModel {
  @Field()
  id!: string;

  @Field(() => CivicTextModel)
  name!: CivicTextModel;

  @Field(() => CivicTextModel)
  shortDescription!: CivicTextModel;

  @Field(() => CivicTextModel, { nullable: true })
  longDescription?: CivicTextModel;

  @Field(() => [String])
  statusStringPatterns!: string[];

  @Field(() => CitizenActionModel, { nullable: true })
  citizenAction?: CitizenActionModel;
}

@ObjectType('CivicsMeasureType')
export class MeasureTypeModel {
  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field()
  chamber!: string;

  @Field()
  votingThreshold!: string;

  @Field()
  reachesGovernor!: boolean;

  @Field(() => CivicTextModel)
  purpose!: CivicTextModel;

  @Field(() => [String])
  lifecycleStageIds!: string[];
}

@ObjectType('CivicsGlossaryEntry')
export class GlossaryEntryModel {
  @Field()
  term!: string;

  @Field()
  slug!: string;

  @Field(() => CivicTextModel)
  definition!: CivicTextModel;

  @Field(() => CivicTextModel, { nullable: true })
  longDefinition?: CivicTextModel;

  @Field(() => [String])
  relatedTerms!: string[];
}

@ObjectType('CivicsSessionScheme')
export class SessionSchemeModel {
  @Field()
  cadence!: string;

  @Field()
  namingPattern!: string;

  @Field(() => CivicTextModel)
  description!: CivicTextModel;
}

@ObjectType('CivicsBlock')
export class CivicsBlockModel {
  @Field(() => [ChamberModel])
  chambers!: ChamberModel[];

  @Field(() => [MeasureTypeModel])
  measureTypes!: MeasureTypeModel[];

  @Field(() => [LifecycleStageModel])
  lifecycleStages!: LifecycleStageModel[];

  @Field(() => SessionSchemeModel, { nullable: true })
  sessionScheme?: SessionSchemeModel;

  @Field(() => [GlossaryEntryModel])
  glossary!: GlossaryEntryModel[];
}

// ── DataType enum ─────────────────────────────────────────────────────────────

/**
 * Data types enum for GraphQL
 */
export enum DataTypeGQL {
  PROPOSITIONS = 'propositions',
  MEETINGS = 'meetings',
  REPRESENTATIVES = 'representatives',
  CAMPAIGN_FINANCE = 'campaign_finance',
  CIVICS = 'civics',
}

registerEnumType(DataTypeGQL, {
  name: 'DataType',
  description: 'Types of data available in the region',
});

/**
 * Region info GraphQL model
 */
@ObjectType()
export class RegionInfoModel {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  description!: string;

  @Field()
  timezone!: string;

  @Field(() => [String], { nullable: true })
  dataSourceUrls?: string[];

  @Field(() => [DataTypeGQL])
  supportedDataTypes!: DataTypeGQL[];

  @Field(() => CivicsBlockModel, { nullable: true })
  civics?: CivicsBlockModel;
}

/**
 * Sync result for a data type
 */
@ObjectType()
export class SyncResultModel {
  @Field(() => DataTypeGQL)
  dataType!: DataTypeGQL;

  @Field()
  itemsProcessed!: number;

  @Field()
  itemsCreated!: number;

  @Field()
  itemsUpdated!: number;

  @Field(() => [String])
  errors!: string[];

  @Field()
  syncedAt!: Date;
}
