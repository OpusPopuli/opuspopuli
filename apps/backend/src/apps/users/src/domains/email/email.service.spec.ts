/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { IEmailProvider } from '@qckstrt/common';
import {
  EmailType as PrismaEmailType,
  EmailStatus as PrismaEmailStatus,
  ConsentType as PrismaConsentType,
  ConsentStatus as PrismaConsentStatus,
} from '@prisma/client';

import { EmailService } from './email.service';
import { PrismaService } from 'src/db/prisma.service';
import { createMockPrismaService } from 'src/test/prisma-mock';

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: IEmailProvider;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'user@example.com';

  // Using 'any' type for mock objects to avoid strict Prisma type checking
  const mockCorrespondence: any = {
    id: 'correspondence-id',
    userId: mockUserId,
    emailType: PrismaEmailType.welcome,
    status: PrismaEmailStatus.pending,
    recipientEmail: 'recipient@example.com',
    recipientName: 'Recipient',
    subject: 'Test Subject',
    bodyPreview: 'Test body preview',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProfile: any = {
    id: 'profile-id',
    userId: mockUserId,
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'johndoe',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAddress: any = {
    id: 'address-id',
    userId: mockUserId,
    addressLine1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConsent: any = {
    id: 'consent-id',
    userId: mockUserId,
    consentType: PrismaConsentType.representative_contact,
    status: PrismaConsentStatus.granted,
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepresentative = {
    id: 'rep-id',
    name: 'Rep. John Smith',
    email: 'rep@congress.gov',
    chamber: 'House',
  };

  const mockProposition = {
    id: 'prop-id',
    title: 'Test Proposition',
  };

  const mockEmailProvider = {
    getName: jest.fn().mockReturnValue('resend'),
    send: jest.fn().mockResolvedValue({ success: true, id: 'email-id-123' }),
    sendBatch: jest.fn().mockResolvedValue([]),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      const config: Record<string, string> = {
        'email.fromName': 'Commonwealth Labs',
        FRONTEND_URL: 'https://app.commonwealthlabs.io',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    // Reset email provider mock to default behavior
    mockEmailProvider.send.mockReset();
    mockEmailProvider.send.mockResolvedValue({
      success: true,
      id: 'email-id-123',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: 'EMAIL_PROVIDER',
          useValue: mockEmailProvider,
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    emailProvider = module.get<IEmailProvider>('EMAIL_PROVIDER');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // sendWelcomeEmail Tests
  // ============================================

  describe('sendWelcomeEmail', () => {
    it('should send welcome email successfully', async () => {
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: PrismaEmailStatus.sent,
      });

      const result = await service.sendWelcomeEmail(
        mockUserId,
        mockUserEmail,
        'John',
      );

      expect(result.success).toBe(true);
      expect(result.correspondenceId).toBe(mockCorrespondence.id);
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUserEmail,
          subject: expect.any(String),
          html: expect.any(String),
          text: expect.any(String),
        }),
      );
    });

    it('should update correspondence status on success', async () => {
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: PrismaEmailStatus.sent,
      });

      await service.sendWelcomeEmail(mockUserId, mockUserEmail);

      expect(mockPrisma.emailCorrespondence.update).toHaveBeenCalled();
    });

    it('should handle send failure gracefully', async () => {
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: PrismaEmailStatus.failed,
      });
      (emailProvider.send as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Rate limit exceeded',
      });

      const result = await service.sendWelcomeEmail(
        mockUserId,
        mockUserEmail,
        'John',
      );

      expect(result.success).toBe(false);
    });

    it('should throw error on provider exception', async () => {
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );
      (emailProvider.send as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        service.sendWelcomeEmail(mockUserId, mockUserEmail, 'John'),
      ).rejects.toThrow('Network error');
    });
  });

  // ============================================
  // contactRepresentative Tests
  // ============================================

  describe('contactRepresentative', () => {
    const contactDto = {
      representativeId: 'rep-id',
      subject: 'Regarding important issue',
      message: 'Dear Representative, I am writing to express my concerns...',
      includeAddress: true,
    };

    it('should send representative contact email successfully', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockPrisma.emailCorrespondence.create.mockResolvedValue({
        ...mockCorrespondence,
        emailType: PrismaEmailType.representative_contact,
      });
      mockPrisma.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        emailType: PrismaEmailType.representative_contact,
        status: PrismaEmailStatus.sent,
      });

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        contactDto,
        mockRepresentative,
        mockProposition,
      );

      expect(result.success).toBe(true);
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockRepresentative.email,
          subject: contactDto.subject,
          replyTo: mockUserEmail,
          tags: expect.arrayContaining([
            { name: 'type', value: 'representative_contact' },
            { name: 'representative_id', value: mockRepresentative.id },
          ]),
        }),
      );
    });

    it('should throw ForbiddenException when consent not granted', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(null);

      await expect(
        service.contactRepresentative(
          mockUserId,
          mockUserEmail,
          contactDto,
          mockRepresentative,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include address when requested and available', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: true },
        mockRepresentative,
      );

      expect(mockPrisma.userAddress.findFirst).toHaveBeenCalledWith({
        where: { userId: mockUserId, isPrimary: true },
      });
    });

    it('should not include address when not requested', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(mockPrisma.userAddress.findFirst).not.toHaveBeenCalled();
    });

    it('should use displayName when firstName not available', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: 'johndoe',
      });
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should use fallback name when no profile name available', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: null,
      });
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should handle contact without proposition', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
        undefined,
      );

      expect(result.success).toBe(true);
    });

    it('should handle email send failure', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: PrismaEmailStatus.failed,
      });
      (emailProvider.send as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Invalid recipient email',
      });

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(false);
    });

    it('should throw error on provider exception', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.emailCorrespondence.create.mockResolvedValue(
        mockCorrespondence,
      );
      mockPrisma.emailCorrespondence.update.mockResolvedValue(
        mockCorrespondence,
      );
      (emailProvider.send as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        service.contactRepresentative(
          mockUserId,
          mockUserEmail,
          { ...contactDto, includeAddress: false },
          mockRepresentative,
        ),
      ).rejects.toThrow('Network error');
    });
  });

  // ============================================
  // getEmailHistory Tests
  // ============================================

  describe('getEmailHistory', () => {
    it('should return paginated email history', async () => {
      const mockItems = [mockCorrespondence, mockCorrespondence];
      mockPrisma.emailCorrespondence.findMany.mockResolvedValue(mockItems);
      mockPrisma.emailCorrespondence.count.mockResolvedValue(2);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array(11).fill(mockCorrespondence);
      mockPrisma.emailCorrespondence.findMany.mockResolvedValue(mockItems);
      mockPrisma.emailCorrespondence.count.mockResolvedValue(20);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });

    it('should filter by email type when provided', async () => {
      mockPrisma.emailCorrespondence.findMany.mockResolvedValue([]);
      mockPrisma.emailCorrespondence.count.mockResolvedValue(0);

      await service.getEmailHistory(
        mockUserId,
        0,
        10,
        PrismaEmailType.representative_contact,
      );

      expect(mockPrisma.emailCorrespondence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: mockUserId,
            emailType: PrismaEmailType.representative_contact,
          },
        }),
      );
    });

    it('should return empty result when no emails exist', async () => {
      mockPrisma.emailCorrespondence.findMany.mockResolvedValue([]);
      mockPrisma.emailCorrespondence.count.mockResolvedValue(0);

      const result = await service.getEmailHistory(mockUserId);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  // ============================================
  // getEmailById Tests
  // ============================================

  describe('getEmailById', () => {
    it('should return email if found', async () => {
      mockPrisma.emailCorrespondence.findFirst.mockResolvedValue(
        mockCorrespondence,
      );

      const result = await service.getEmailById(
        mockUserId,
        mockCorrespondence.id,
      );

      expect(result).toEqual(mockCorrespondence);
      expect(mockPrisma.emailCorrespondence.findFirst).toHaveBeenCalledWith({
        where: { id: mockCorrespondence.id, userId: mockUserId },
      });
    });

    it('should return null if email not found', async () => {
      mockPrisma.emailCorrespondence.findFirst.mockResolvedValue(null);

      const result = await service.getEmailById(mockUserId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // getMailtoLink Tests
  // ============================================

  describe('getMailtoLink', () => {
    it('should generate mailto link', () => {
      const result = service.getMailtoLink(
        'rep@congress.gov',
        'Test Subject',
        'Test body',
      );

      expect(result).toContain('mailto:rep@congress.gov');
      expect(result).toContain('subject=');
      expect(result).toContain('body=');
    });

    it('should encode special characters', () => {
      const result = service.getMailtoLink(
        'rep@congress.gov',
        'Subject with spaces & symbols',
        'Body with\nnewlines',
      );

      expect(result).toContain('mailto:');
      expect(result).not.toContain(' ');
    });
  });
});
