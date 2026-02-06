import { Inject, Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from '@opuspopuli/common';
import {
  welcomeEmailTemplate,
  representativeContactTemplate,
  generateMailtoLink,
} from '@opuspopuli/email-provider';
import {
  DbService,
  EmailCorrespondence as DbEmailCorrespondence,
  EmailType as DbEmailType,
  EmailStatus as DbEmailStatus,
  ConsentType as DbConsentType,
  ConsentStatus as DbConsentStatus,
} from '@opuspopuli/relationaldb-provider';
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
  items: DbEmailCorrespondence[];
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
    private readonly db: DbService,
    private readonly configService: ConfigService,
  ) {
    this.platformName =
      this.configService.get<string>('email.fromName') || 'Opus Populi';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'https://app.opuspopuli.org';
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

    let correspondence = await this.db.emailCorrespondence.create({
      data: {
        userId,
        emailType: DbEmailType.welcome,
        status: DbEmailStatus.pending,
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
        correspondence = await this.db.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: DbEmailStatus.sent,
            sentAt: new Date(),
            resendId: result.id,
          },
        });
      } else {
        correspondence = await this.db.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: DbEmailStatus.failed,
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
      await this.db.emailCorrespondence.update({
        where: { id: correspondence.id },
        data: {
          status: DbEmailStatus.failed,
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
    const consent = await this.db.userConsent.findFirst({
      where: {
        userId,
        consentType: DbConsentType.representative_contact,
        status: DbConsentStatus.granted,
      },
    });

    if (!consent) {
      throw new ForbiddenException(
        'User has not consented to representative contact. Please update your consent settings.',
      );
    }

    // Get user profile and address
    const profile = await this.db.userProfile.findUnique({
      where: { userId },
    });
    const senderName =
      profile?.displayName || profile?.firstName || 'A Constituent';

    let senderAddress: string | undefined;
    if (dto.includeAddress) {
      const address = await this.db.userAddress.findFirst({
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

    let correspondence = await this.db.emailCorrespondence.create({
      data: {
        userId,
        emailType: DbEmailType.representative_contact,
        status: DbEmailStatus.pending,
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
        correspondence = await this.db.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: DbEmailStatus.sent,
            sentAt: new Date(),
            resendId: result.id,
          },
        });
      } else {
        correspondence = await this.db.emailCorrespondence.update({
          where: { id: correspondence.id },
          data: {
            status: DbEmailStatus.failed,
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
      await this.db.emailCorrespondence.update({
        where: { id: correspondence.id },
        data: {
          status: DbEmailStatus.failed,
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
    emailType?: DbEmailType,
  ): Promise<EmailHistoryResult> {
    const where: { userId: string; emailType?: DbEmailType } = { userId };
    if (emailType) {
      where.emailType = emailType;
    }

    const [items, total] = await Promise.all([
      this.db.emailCorrespondence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: take + 1,
      }),
      this.db.emailCorrespondence.count({ where }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return { items: paginatedItems, total, hasMore };
  }

  async getEmailById(
    userId: string,
    id: string,
  ): Promise<DbEmailCorrespondence | null> {
    return this.db.emailCorrespondence.findFirst({
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
