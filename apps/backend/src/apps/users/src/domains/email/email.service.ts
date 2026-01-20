import { Inject, Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from '@qckstrt/common';
import {
  welcomeEmailTemplate,
  representativeContactTemplate,
  generateMailtoLink,
} from '@qckstrt/email-provider';
import {
  EmailCorrespondence as PrismaEmailCorrespondence,
  EmailType as PrismaEmailType,
  EmailStatus as PrismaEmailStatus,
  ConsentType as PrismaConsentType,
  ConsentStatus as PrismaConsentStatus,
} from '@prisma/client';

import { PrismaService } from 'src/db/prisma.service';
import { ContactRepresentativeDto } from './dto/contact-representative.dto';

interface RepresentativeInfo {
  id: string;
  name: string;
  email: string;
  chamber?: string;
}

interface PropositionInfo {
  id: string;
  title: string;
}

interface EmailHistoryResult {
  items: PrismaEmailCorrespondence[];
  total: number;
  hasMore: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly platformName: string;
  private readonly frontendUrl: string;

  constructor(
    @Inject('EMAIL_PROVIDER')
    private readonly emailProvider: IEmailProvider,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.platformName =
      this.configService.get<string>('email.fromName') || 'Commonwealth Labs';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'https://app.commonwealthlabs.io';
  }

  // ============================================
  // Send Welcome Email
  // ============================================

  async sendWelcomeEmail(
    userId: string,
    email: string,
    userName?: string,
  ): Promise<{ success: boolean; correspondenceId?: string }> {
    const template = welcomeEmailTemplate({
      userName,
      platformName: this.platformName,
      loginUrl: this.frontendUrl,
    });

    let correspondence = await this.prisma.emailCorrespondence.create({
      data: {
        userId,
        emailType: PrismaEmailType.welcome,
        status: PrismaEmailStatus.pending,
        recipientEmail: email,
        recipientName: userName,
        subject: template.subject,
        bodyPreview: template.text.substring(0, 500),
      },
    });

    try {
      const result = await this.emailProvider.send({
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (result.success) {
        correspondence = await this.prisma.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: PrismaEmailStatus.sent,
            sentAt: new Date(),
            resendId: result.id,
          },
        });
      } else {
        correspondence = await this.prisma.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: PrismaEmailStatus.failed,
            errorMessage: result.error,
          },
        });
      }

      this.logger.log(
        `Welcome email ${result.success ? 'sent' : 'failed'} for user ${userId}`,
      );

      return { success: result.success, correspondenceId: correspondence.id };
    } catch (error) {
      const err = error as Error;
      await this.prisma.emailCorrespondence.update({
        where: { id: correspondence.id },
        data: {
          status: PrismaEmailStatus.failed,
          errorMessage: err.message,
        },
      });

      this.logger.error(`Failed to send welcome email: ${err.message}`);
      throw error;
    }
  }

  // ============================================
  // Contact Representative
  // ============================================

  async contactRepresentative(
    userId: string,
    userEmail: string,
    dto: ContactRepresentativeDto,
    representative: RepresentativeInfo,
    proposition?: PropositionInfo,
  ): Promise<{ success: boolean; correspondenceId?: string }> {
    // Verify user has consent for representative contact
    const consent = await this.prisma.userConsent.findFirst({
      where: {
        userId,
        consentType: PrismaConsentType.representative_contact,
        status: PrismaConsentStatus.granted,
      },
    });

    if (!consent) {
      throw new ForbiddenException(
        'User has not consented to representative contact. Please update your consent settings.',
      );
    }

    // Get user profile and address
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });
    const senderName =
      profile?.displayName || profile?.firstName || 'A Constituent';

    let senderAddress: string | undefined;
    if (dto.includeAddress) {
      const address = await this.prisma.userAddress.findFirst({
        where: { userId, isPrimary: true },
      });
      if (address) {
        senderAddress = `${address.addressLine1}, ${address.city}, ${address.state} ${address.postalCode}`;
      }
    }

    const template = representativeContactTemplate({
      senderName,
      senderEmail: userEmail,
      senderAddress,
      representativeName: representative.name,
      representativeTitle: representative.chamber,
      subject: dto.subject,
      message: dto.message,
      propositionTitle: proposition?.title,
      propositionId: proposition?.id,
      platformName: this.platformName,
    });

    let correspondence = await this.prisma.emailCorrespondence.create({
      data: {
        userId,
        emailType: PrismaEmailType.representative_contact,
        status: PrismaEmailStatus.pending,
        recipientEmail: representative.email,
        recipientName: representative.name,
        subject: dto.subject,
        bodyPreview: dto.message.substring(0, 500),
        representativeId: representative.id,
        representativeName: representative.name,
        propositionId: proposition?.id,
        propositionTitle: proposition?.title,
      },
    });

    try {
      const result = await this.emailProvider.send({
        to: representative.email,
        subject: dto.subject,
        html: template.html,
        text: template.text,
        replyTo: userEmail,
        tags: [
          { name: 'type', value: 'representative_contact' },
          { name: 'representative_id', value: representative.id },
        ],
      });

      if (result.success) {
        correspondence = await this.prisma.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: PrismaEmailStatus.sent,
            sentAt: new Date(),
            resendId: result.id,
          },
        });
      } else {
        correspondence = await this.prisma.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: PrismaEmailStatus.failed,
            errorMessage: result.error,
          },
        });
      }

      this.logger.log(
        `Representative contact email ${result.success ? 'sent' : 'failed'} from user ${userId} to ${representative.name}`,
      );

      return { success: result.success, correspondenceId: correspondence.id };
    } catch (error) {
      const err = error as Error;
      await this.prisma.emailCorrespondence.update({
        where: { id: correspondence.id },
        data: {
          status: PrismaEmailStatus.failed,
          errorMessage: err.message,
        },
      });

      this.logger.error(
        `Failed to send representative contact email: ${err.message}`,
      );
      throw error;
    }
  }

  // ============================================
  // Email History
  // ============================================

  async getEmailHistory(
    userId: string,
    skip: number = 0,
    take: number = 10,
    emailType?: PrismaEmailType,
  ): Promise<EmailHistoryResult> {
    const where: { userId: string; emailType?: PrismaEmailType } = { userId };
    if (emailType) {
      where.emailType = emailType;
    }

    const [items, total] = await Promise.all([
      this.prisma.emailCorrespondence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: take + 1,
      }),
      this.prisma.emailCorrespondence.count({ where }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return { items: paginatedItems, total, hasMore };
  }

  async getEmailById(
    userId: string,
    id: string,
  ): Promise<PrismaEmailCorrespondence | null> {
    return this.prisma.emailCorrespondence.findFirst({
      where: { id, userId },
    });
  }

  // ============================================
  // Mailto Link Generation
  // ============================================

  getMailtoLink(
    representativeEmail: string,
    subject: string,
    body: string,
  ): string {
    return generateMailtoLink(representativeEmail, subject, body);
  }
}
