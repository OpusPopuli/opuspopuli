/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { IEmailProvider } from '@opuspopuli/common';
import {
  DbService,
  EmailType as DbEmailType,
  EmailStatus as DbEmailStatus,
  ConsentType as DbConsentType,
  ConsentStatus as DbConsentStatus,
} from '@opuspopuli/relationaldb-provider';

import { EmailService } from './email.service';
import { createMockDbService } from '@opuspopuli/relationaldb-provider/testing';

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: IEmailProvider;
  let mockDb: ReturnType<typeof createMockDbService>;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'user@example.com';

  // Using 'any' type for mock objects to avoid strict type checking
  const mockCorrespondence: any = {
    id: 'correspondence-id',
    userId: mockUserId,
    emailType: DbEmailType.welcome,
    status: DbEmailStatus.pending,
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
    consentType: DbConsentType.representative_contact,
    status: DbConsentStatus.granted,
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
        'email.fromName': 'Opus Populi',
        FRONTEND_URL: 'https://app.opuspopuli.org',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    mockDb = createMockDbService();

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
        { provide: DbService, useValue: mockDb },
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
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: DbEmailStatus.sent,
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
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: DbEmailStatus.sent,
      });

      await service.sendWelcomeEmail(mockUserId, mockUserEmail);

      expect(mockDb.emailCorrespondence.update).toHaveBeenCalled();
    });

    it('should handle send failure gracefully', async () => {
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: DbEmailStatus.failed,
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
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);
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
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockDb.emailCorrespondence.create.mockResolvedValue({
        ...mockCorrespondence,
        emailType: DbEmailType.representative_contact,
      });
      mockDb.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        emailType: DbEmailType.representative_contact,
        status: DbEmailStatus.sent,
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
      mockDb.userConsent.findFirst.mockResolvedValue(null);

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
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: true },
        mockRepresentative,
      );

      expect(mockDb.userAddress.findFirst).toHaveBeenCalledWith({
        where: { userId: mockUserId, isPrimary: true },
      });
    });

    it('should not include address when not requested', async () => {
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(mockDb.userAddress.findFirst).not.toHaveBeenCalled();
    });

    it('should use displayName when firstName not available', async () => {
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: 'johndoe',
      });
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should use fallback name when no profile name available', async () => {
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: null,
      });
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should handle contact without proposition', async () => {
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);

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
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue({
        ...mockCorrespondence,
        status: DbEmailStatus.failed,
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
      mockDb.userConsent.findFirst.mockResolvedValue(mockConsent);
      mockDb.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockDb.emailCorrespondence.create.mockResolvedValue(mockCorrespondence);
      mockDb.emailCorrespondence.update.mockResolvedValue(mockCorrespondence);
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
      mockDb.emailCorrespondence.findMany.mockResolvedValue(mockItems);
      mockDb.emailCorrespondence.count.mockResolvedValue(2);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array(11).fill(mockCorrespondence);
      mockDb.emailCorrespondence.findMany.mockResolvedValue(mockItems);
      mockDb.emailCorrespondence.count.mockResolvedValue(20);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });

    it('should filter by email type when provided', async () => {
      mockDb.emailCorrespondence.findMany.mockResolvedValue([]);
      mockDb.emailCorrespondence.count.mockResolvedValue(0);

      await service.getEmailHistory(
        mockUserId,
        0,
        10,
        DbEmailType.representative_contact,
      );

      expect(mockDb.emailCorrespondence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: mockUserId,
            emailType: DbEmailType.representative_contact,
          },
        }),
      );
    });

    it('should return empty result when no emails exist', async () => {
      mockDb.emailCorrespondence.findMany.mockResolvedValue([]);
      mockDb.emailCorrespondence.count.mockResolvedValue(0);

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
      mockDb.emailCorrespondence.findFirst.mockResolvedValue(
        mockCorrespondence,
      );

      const result = await service.getEmailById(
        mockUserId,
        mockCorrespondence.id,
      );

      expect(result).toEqual(mockCorrespondence);
      expect(mockDb.emailCorrespondence.findFirst).toHaveBeenCalledWith({
        where: { id: mockCorrespondence.id, userId: mockUserId },
      });
    });

    it('should return null if email not found', async () => {
      mockDb.emailCorrespondence.findFirst.mockResolvedValue(null);

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
