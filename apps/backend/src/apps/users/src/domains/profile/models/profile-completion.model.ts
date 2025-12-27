import { Field, ObjectType, Int } from '@nestjs/graphql';

@ObjectType()
export class CoreFieldsStatus {
  @Field()
  hasName!: boolean;

  @Field()
  hasPhoto!: boolean;

  @Field()
  hasTimezone!: boolean;

  @Field()
  hasAddress!: boolean;
}

@ObjectType()
export class ProfileCompletionResult {
  @Field(() => Int)
  percentage!: number;

  @Field()
  isComplete!: boolean;

  @Field(() => CoreFieldsStatus)
  coreFieldsComplete!: CoreFieldsStatus;

  @Field(() => [String])
  suggestedNextSteps!: string[];
}
