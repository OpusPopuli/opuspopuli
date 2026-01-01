import { UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Context,
  ID,
  Int,
} from '@nestjs/graphql';

import { AuthGuard } from 'src/common/guards/auth.guard';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { EmailType } from 'src/db/entities/email-correspondence.entity';

import { EmailService } from './email.service';
import {
  ContactRepresentativeDto,
  RepresentativeInfoDto,
  PropositionInfoDto,
} from './dto/contact-representative.dto';
import {
  EmailCorrespondenceModel,
  PaginatedEmailCorrespondence,
  SendEmailResult,
} from './models/email-correspondence.model';

@Resolver()
export class EmailResolver {
  constructor(private readonly emailService: EmailService) {}

  // ============================================
  // Queries
  // ============================================

  @Query(() => PaginatedEmailCorrespondence, { name: 'myEmailHistory' })
  @UseGuards(AuthGuard)
  async getMyEmailHistory(
    @Context() context: GqlContext,
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
    @Args({ name: 'emailType', type: () => EmailType, nullable: true })
    emailType?: EmailType,
  ): Promise<PaginatedEmailCorrespondence> {
    const user = getUserFromContext(context);
    return this.emailService.getEmailHistory(user.id, skip, take, emailType);
  }

  @Query(() => EmailCorrespondenceModel, { nullable: true, name: 'myEmail' })
  @UseGuards(AuthGuard)
  async getMyEmail(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<EmailCorrespondenceModel | null> {
    const user = getUserFromContext(context);
    return this.emailService.getEmailById(user.id, id);
  }

  @Query(() => String, { name: 'representativeMailtoLink' })
  @UseGuards(AuthGuard)
  async getRepresentativeMailtoLink(
    @Args('representativeEmail') representativeEmail: string,
    @Args('subject') subject: string,
    @Args('body') body: string,
  ): Promise<string> {
    return this.emailService.getMailtoLink(representativeEmail, subject, body);
  }

  // ============================================
  // Mutations
  // ============================================

  @Mutation(() => SendEmailResult)
  @UseGuards(AuthGuard)
  async contactRepresentative(
    @Args('input') input: ContactRepresentativeDto,
    @Args('representative') representative: RepresentativeInfoDto,
    @Args('proposition', { nullable: true }) proposition: PropositionInfoDto,
    @Context() context: GqlContext,
  ): Promise<SendEmailResult> {
    const user = getUserFromContext(context);

    try {
      const result = await this.emailService.contactRepresentative(
        user.id,
        user.email,
        input,
        {
          id: representative.id,
          name: representative.name,
          email: representative.email,
          chamber: representative.chamber,
        },
        proposition
          ? {
              id: proposition.id,
              title: proposition.title,
            }
          : undefined,
      );

      return {
        success: result.success,
        correspondenceId: result.correspondenceId,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
}
