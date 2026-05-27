import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

/**
 * GraphQL surface for the append-only behavioral event log (doc §4.12).
 * Exposed read-only via the `myEvents` query (model-of-me page in
 * #742-C slice). The `recordEvent` mutation accepts an input DTO and
 * returns this shape on success.
 */
@ObjectType('UserEvent')
export class UserEventModel {
  @Field(() => ID) id!: string;
  @Field() verb!: string;
  @Field() objectType!: string;
  @Field() objectId!: string;
  @Field(() => GraphQLJSON, { nullable: true })
  context?: Record<string, unknown>;
  @Field(() => GraphQLISODateTime) occurredAt!: Date;
}
