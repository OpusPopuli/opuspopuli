import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { KnowledgeService } from './knowledge.service';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PaginatedSearchResults } from './models/search-result.model';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';

/**
 * Knowledge Resolver
 *
 * Handles semantic search and RAG operations.
 */
@Resolver()
export class KnowledgeResolver {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Mutation(() => String)
  @UseGuards(AuthGuard)
  async answerQuery(
    @Args('query') query: string,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.knowledgeService.answerQuery(user.id, query);
  }

  @Query(() => PaginatedSearchResults)
  @UseGuards(AuthGuard)
  async searchText(
    @Args('query') query: string,
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
    @Context() context: GqlContext,
  ): Promise<PaginatedSearchResults> {
    const user = getUserFromContext(context);
    return this.knowledgeService.searchText(user.id, query, skip, take);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async indexDocument(
    @Args('documentId') documentId: string,
    @Args('text') text: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    try {
      await this.knowledgeService.indexDocument(user.id, documentId, text);
      return true;
    } catch {
      return false;
    }
  }
}
