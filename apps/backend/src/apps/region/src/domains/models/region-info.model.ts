import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';

/**
 * Data types enum for GraphQL
 */
export enum DataTypeGQL {
  PROPOSITIONS = 'propositions',
  MEETINGS = 'meetings',
  REPRESENTATIVES = 'representatives',
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
