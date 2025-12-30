/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { IEmailProvider } from '@qckstrt/common';

import { EmailService } from './email.service';
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

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: IEmailProvider;
  let correspondenceRepo: Repository<EmailCorrespondenceEntity>;
  let profileRepo: Repository<UserProfileEntity>;
  let addressRepo: Repository<UserAddressEntity>;
  let consentRepo: Repository<UserConsentEntity>;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'user@example.com';

  const mockCorrespondence = {
    id: 'correspondence-id',
    userId: mockUserId,
    emailType: EmailType.WELCOME,
    status: EmailStatus.PENDING,
    recipientEmail: 'recipient@example.com',
    recipientName: 'Recipient',
    subject: 'Test Subject',
    bodyPreview: 'Test body preview',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as EmailCorrespondenceEntity;

  const mockProfile = {
    id: 'profile-id',
    userId: mockUserId,
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'johndoe',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserProfileEntity;

  const mockAddress = {
    id: 'address-id',
    userId: mockUserId,
    addressLine1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserAddressEntity;

  const mockConsent = {
    id: 'consent-id',
    userId: mockUserId,
    consentType: ConsentType.REPRESENTATIVE_CONTACT,
    status: ConsentStatus.GRANTED,
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserConsentEntity;

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

  beforeEach(async () => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: 'EMAIL_PROVIDER',
          useValue: mockEmailProvider,
        },
        {
          provide: getRepositoryToken(EmailCorrespondenceEntity),
          useValue: createMock<Repository<EmailCorrespondenceEntity>>(),
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: createMock<Repository<UserProfileEntity>>(),
        },
        {
          provide: getRepositoryToken(UserAddressEntity),
          useValue: createMock<Repository<UserAddressEntity>>(),
        },
        {
          provide: getRepositoryToken(UserConsentEntity),
          useValue: createMock<Repository<UserConsentEntity>>(),
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    emailProvider = module.get<IEmailProvider>('EMAIL_PROVIDER');
    correspondenceRepo = module.get<Repository<EmailCorrespondenceEntity>>(
      getRepositoryToken(EmailCorrespondenceEntity),
    );
    profileRepo = module.get<Repository<UserProfileEntity>>(
      getRepositoryToken(UserProfileEntity),
    );
    addressRepo = module.get<Repository<UserAddressEntity>>(
      getRepositoryToken(UserAddressEntity),
    );
    consentRepo = module.get<Repository<UserConsentEntity>>(
      getRepositoryToken(UserConsentEntity),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // sendWelcomeEmail Tests
  // ============================================

  describe('sendWelcomeEmail', () => {
    it('should send welcome email successfully', async () => {
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

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
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

      await service.sendWelcomeEmail(mockUserId, mockUserEmail);

      expect(correspondenceRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should handle send failure gracefully', async () => {
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);
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
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);
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
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      addressRepo.findOne = jest.fn().mockResolvedValue(mockAddress);
      correspondenceRepo.create = jest.fn().mockReturnValue({
        ...mockCorrespondence,
        emailType: EmailType.REPRESENTATIVE_CONTACT,
      });
      correspondenceRepo.save = jest.fn().mockResolvedValue({
        ...mockCorrespondence,
        emailType: EmailType.REPRESENTATIVE_CONTACT,
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
      consentRepo.findOne = jest.fn().mockResolvedValue(null);

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
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      addressRepo.findOne = jest.fn().mockResolvedValue(mockAddress);
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: true },
        mockRepresentative,
      );

      expect(addressRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUserId, isPrimary: true },
      });
    });

    it('should not include address when not requested', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

      await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(addressRepo.findOne).not.toHaveBeenCalled();
    });

    it('should use displayName when firstName not available', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: 'johndoe',
      });
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should use fallback name when no profile name available', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: null,
      });
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

      const result = await service.contactRepresentative(
        mockUserId,
        mockUserEmail,
        { ...contactDto, includeAddress: false },
        mockRepresentative,
      );

      expect(result.success).toBe(true);
    });

    it('should handle contact without proposition', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);

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
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);
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
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      correspondenceRepo.create = jest.fn().mockReturnValue(mockCorrespondence);
      correspondenceRepo.save = jest.fn().mockResolvedValue(mockCorrespondence);
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
      correspondenceRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([mockItems, 2]);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array(11).fill(mockCorrespondence);
      correspondenceRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([mockItems, 20]);

      const result = await service.getEmailHistory(mockUserId, 0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });

    it('should filter by email type when provided', async () => {
      correspondenceRepo.findAndCount = jest.fn().mockResolvedValue([[], 0]);

      await service.getEmailHistory(
        mockUserId,
        0,
        10,
        EmailType.REPRESENTATIVE_CONTACT,
      );

      expect(correspondenceRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: mockUserId,
            emailType: EmailType.REPRESENTATIVE_CONTACT,
          },
        }),
      );
    });

    it('should return empty result when no emails exist', async () => {
      correspondenceRepo.findAndCount = jest.fn().mockResolvedValue([[], 0]);

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
      correspondenceRepo.findOne = jest
        .fn()
        .mockResolvedValue(mockCorrespondence);

      const result = await service.getEmailById(
        mockUserId,
        mockCorrespondence.id,
      );

      expect(result).toEqual(mockCorrespondence);
      expect(correspondenceRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockCorrespondence.id, userId: mockUserId },
      });
    });

    it('should return null if email not found', async () => {
      correspondenceRepo.findOne = jest.fn().mockResolvedValue(null);

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
