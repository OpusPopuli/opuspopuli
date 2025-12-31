import {
  Args,
  Context,
  Parent,
  Mutation,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { File } from './models/file.model';
import { User } from './models/user.model';
import { DocumentsService } from './documents.service';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';

/**
 * Documents Resolver
 *
 * Handles document metadata and file storage operations.
 */
@Resolver(() => File)
export class DocumentsResolver {
  constructor(private readonly documentsService: DocumentsService) {}

  @Query(() => [File])
  @UseGuards(AuthGuard)
  listFiles(@Context() context: GqlContext): Promise<File[]> {
    const user = getUserFromContext(context);
    return this.documentsService.listFiles(user.id);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getUploadUrl(
    @Args('filename') filename: string,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getUploadUrl(user.id, filename);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getDownloadUrl(
    @Args('filename') filename: string,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getDownloadUrl(user.id, filename);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async deleteFile(
    @Args('filename') filename: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.deleteFile(user.id, filename);
  }

  @ResolveField(() => User)
  user(@Parent() file: File): User {
    return { id: file.userId };
  }
}
