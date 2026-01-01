import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { KnowledgeService } from './knowledge.service';
import { Logger, UseGuards } from '@nestjs/common';
import { UserInputError } from '@nestjs/apollo';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PaginatedSearchResults } from './models/search-result.model';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import {
  QueryInput,
  SearchInput,
  IndexDocumentInput,
} from './dto/knowledge.dto';

/**
 * Knowledge Resolver
 *
 * Handles semantic search and RAG operations.
 * All inputs are validated via class-validator decorators in DTOs.
 */
@Resolver()
export class KnowledgeResolver {
  private readonly logger = new Logger(KnowledgeResolver.name, {
    timestamp: true,
  });

  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Mutation(() => String)
  @UseGuards(AuthGuard)
  async answerQuery(
    @Args('input') input: QueryInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.knowledgeService.answerQuery(user.id, input.query);
  }

  @Query(() => PaginatedSearchResults)
  @UseGuards(AuthGuard)
  async searchText(
    @Args('input') input: SearchInput,
    @Context() context: GqlContext,
  ): Promise<PaginatedSearchResults> {
    const user = getUserFromContext(context);
    return this.knowledgeService.searchText(
      user.id,
      input.query,
      input.skip,
      input.take,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async indexDocument(
    @Args('input') input: IndexDocumentInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    try {
      await this.knowledgeService.indexDocument(
        user.id,
        input.documentId,
        input.text,
      );
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to index document ${input.documentId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new UserInputError(`Failed to index document: ${errorMessage}`);
    }
  }
}
