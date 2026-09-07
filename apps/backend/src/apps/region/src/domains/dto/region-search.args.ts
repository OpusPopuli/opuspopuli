import { ArgsType, Field } from '@nestjs/graphql';
import { IsOptional, MaxLength } from 'class-validator';
import { SEARCH_QUERY_MAX_LENGTH } from '../region-search.service';

/**
 * Search args validated at the edge (#1153). The service also truncates to
 * SEARCH_QUERY_MAX_LENGTH, but that runs AFTER the GraphQL audit
 * interceptor has captured inputVariables — only a ValidationPipe
 * rejection here stops an oversized payload from ever reaching the audit
 * write path. Bare `@Args` scalars bypass class-validator, which is why
 * these are @ArgsType classes.
 */
@ArgsType()
export class RegionSearchQueryArgs {
  @Field()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query!: string;
}

@ArgsType()
export class OptionalSearchArgs {
  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  search?: string;
}
