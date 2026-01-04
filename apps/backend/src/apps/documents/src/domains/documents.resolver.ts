import {
  Args,
  Context,
  Extensions,
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
import { FilenameInput } from './dto/documents.dto';

/**
 * Documents Resolver
 *
 * Handles document metadata and file storage operations.
 * Filename inputs are validated to prevent path traversal attacks.
 */
@Resolver(() => File)
export class DocumentsResolver {
  constructor(private readonly documentsService: DocumentsService) {}

  @Query(() => [File])
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 15 }) // List operation
  listFiles(@Context() context: GqlContext): Promise<File[]> {
    const user = getUserFromContext(context);
    return this.documentsService.listFiles(user.id);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getUploadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getUploadUrl(user.id, input.filename);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getDownloadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getDownloadUrl(user.id, input.filename);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async deleteFile(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.deleteFile(user.id, input.filename);
  }

  @ResolveField(() => User)
  user(@Parent() file: File): User {
    return { id: file.userId };
  }
}
