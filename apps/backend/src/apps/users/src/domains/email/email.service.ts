import { Inject, Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IEmailProvider } from '@qckstrt/common';
import {
  welcomeEmailTemplate,
  representativeContactTemplate,
  generateMailtoLink,
} from '@qckstrt/email-provider';

import {
  EmailCorrespondenceEntity,
  EmailType,
  EmailStatus,
} from 'src/db/entities/email-correspondence.entity';
import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import {
  UserConsentEntity,
  ConsentType,
  ConsentStatus,
} from 'src/db/entities/user-consent.entity';

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
  items: EmailCorrespondenceEntity[];
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
    @InjectRepository(EmailCorrespondenceEntity)
    private readonly correspondenceRepo: Repository<EmailCorrespondenceEntity>,
    @InjectRepository(UserProfileEntity)
    private readonly profileRepo: Repository<UserProfileEntity>,
    @InjectRepository(UserAddressEntity)
    private readonly addressRepo: Repository<UserAddressEntity>,
    @InjectRepository(UserConsentEntity)
    private readonly consentRepo: Repository<UserConsentEntity>,
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

    const correspondence = this.correspondenceRepo.create({
      userId,
      emailType: EmailType.WELCOME,
      status: EmailStatus.PENDING,
      recipientEmail: email,
      recipientName: userName,
      subject: template.subject,
      bodyPreview: template.text.substring(0, 500),
    });

    await this.correspondenceRepo.save(correspondence);

    try {
      const result = await this.emailProvider.send({
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (result.success) {
        correspondence.status = EmailStatus.SENT;
        correspondence.sentAt = new Date();
        correspondence.resendId = result.id;
      } else {
        correspondence.status = EmailStatus.FAILED;
        correspondence.errorMessage = result.error;
      }

      await this.correspondenceRepo.save(correspondence);

      this.logger.log(
        `Welcome email ${result.success ? 'sent' : 'failed'} for user ${userId}`,
      );

      return { success: result.success, correspondenceId: correspondence.id };
    } catch (error) {
      const err = error as Error;
      correspondence.status = EmailStatus.FAILED;
      correspondence.errorMessage = err.message;
      await this.correspondenceRepo.save(correspondence);

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
    const consent = await this.consentRepo.findOne({
      where: {
        userId,
        consentType: ConsentType.REPRESENTATIVE_CONTACT,
        status: ConsentStatus.GRANTED,
      },
    });

    if (!consent) {
      throw new ForbiddenException(
        'User has not consented to representative contact. Please update your consent settings.',
      );
    }

    // Get user profile and address
    const profile = await this.profileRepo.findOne({ where: { userId } });
    const senderName =
      profile?.displayName || profile?.firstName || 'A Constituent';

    let senderAddress: string | undefined;
    if (dto.includeAddress) {
      const address = await this.addressRepo.findOne({
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

    const correspondence = this.correspondenceRepo.create({
      userId,
      emailType: EmailType.REPRESENTATIVE_CONTACT,
      status: EmailStatus.PENDING,
      recipientEmail: representative.email,
      recipientName: representative.name,
      subject: dto.subject,
      bodyPreview: dto.message.substring(0, 500),
      representativeId: representative.id,
      representativeName: representative.name,
      propositionId: proposition?.id,
      propositionTitle: proposition?.title,
    });

    await this.correspondenceRepo.save(correspondence);

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
        correspondence.status = EmailStatus.SENT;
        correspondence.sentAt = new Date();
        correspondence.resendId = result.id;
      } else {
        correspondence.status = EmailStatus.FAILED;
        correspondence.errorMessage = result.error;
      }

      await this.correspondenceRepo.save(correspondence);

      this.logger.log(
        `Representative contact email ${result.success ? 'sent' : 'failed'} from user ${userId} to ${representative.name}`,
      );

      return { success: result.success, correspondenceId: correspondence.id };
    } catch (error) {
      const err = error as Error;
      correspondence.status = EmailStatus.FAILED;
      correspondence.errorMessage = err.message;
      await this.correspondenceRepo.save(correspondence);

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
    emailType?: EmailType,
  ): Promise<EmailHistoryResult> {
    const where: Record<string, unknown> = { userId };
    if (emailType) {
      where.emailType = emailType;
    }

    const [items, total] = await this.correspondenceRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: take + 1,
    });

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return { items: paginatedItems, total, hasMore };
  }

  async getEmailById(
    userId: string,
    id: string,
  ): Promise<EmailCorrespondenceEntity | null> {
    return this.correspondenceRepo.findOne({
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
