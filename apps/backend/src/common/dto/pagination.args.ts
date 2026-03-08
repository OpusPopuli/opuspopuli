import { ArgsType, Field, Int } from '@nestjs/graphql';
import { Min, Max } from 'class-validator';

@ArgsType()
export class PaginationArgs {
  @Field(() => Int, { defaultValue: 0 })
  @Min(0)
  skip: number = 0;

  @Field(() => Int, { defaultValue: 10 })
  @Min(1)
  @Max(100)
  take: number = 10;
}
