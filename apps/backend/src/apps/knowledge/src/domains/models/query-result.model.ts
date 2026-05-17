import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class QueryResult {
  @Field()
  answer!: string;

  @Field(() => [String])
  sourcedFrom!: string[];
}
