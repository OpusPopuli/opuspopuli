import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { KnowledgeService } from './knowledge.service';
import { UseGuards } from '@nestjs/common';
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
    } catch {
      return false;
    }
  }
}
