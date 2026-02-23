import { Field, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@ObjectType()
export class DataExportResult {
  @Field()
  exportedAt!: string;

  @Field(() => GraphQLJSON)
  data!: Record<string, unknown>;
}
