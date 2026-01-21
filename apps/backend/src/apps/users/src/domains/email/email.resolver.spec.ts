/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { EmailResolver } from './email.resolver';
import { EmailService } from './email.service';
import { EmailType, EmailStatus } from 'src/common/enums/email.enum';

describe('EmailResolver', () => {
  let resolver: EmailResolver;
  let emailService: EmailService;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'test@example.com';

  const mockContext = {
    req: {
      user: { id: mockUserId, email: mockUserEmail },
    },
  };

  const mockContextNoUser = {
    req: {},
  };

  const mockCorrespondence = {
    id: 'correspondence-id',
    userId: mockUserId,
    emailType: EmailType.WELCOME,
    status: EmailStatus.SENT,
    recipientEmail: 'recipient@example.com',
    recipientName: 'Recipient',
    subject: 'Test Subject',
    bodyPreview: 'Test body preview',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailResolver,
        {
          provide: EmailService,
          useValue: createMock<EmailService>(),
        },
      ],
    }).compile();

    resolver = module.get<EmailResolver>(EmailResolver);
    emailService = module.get<EmailService>(EmailService);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  // ============================================
  // Query Tests
  // ============================================

  describe('getMyEmailHistory', () => {
    it('should return paginated email history for authenticated user', async () => {
      const mockResult = {
        items: [mockCorrespondence],
        total: 1,
        hasMore: false,
      };

      emailService.getEmailHistory = jest.fn().mockResolvedValue(mockResult);

      const result = await resolver.getMyEmailHistory(
        mockContext as any,
        0,
        10,
        undefined,
      );

      expect(result).toEqual(mockResult);
      expect(emailService.getEmailHistory).toHaveBeenCalledWith(
        mockUserId,
        0,
        10,
        undefined,
      );
    });

    it('should filter by email type when provided', async () => {
      const mockResult = {
        items: [
          {
            ...mockCorrespondence,
            emailType: EmailType.REPRESENTATIVE_CONTACT,
          },
        ],
        total: 1,
        hasMore: false,
      };

      emailService.getEmailHistory = jest.fn().mockResolvedValue(mockResult);

      await resolver.getMyEmailHistory(
        mockContext as any,
        0,
        10,
        EmailType.REPRESENTATIVE_CONTACT,
      );

      expect(emailService.getEmailHistory).toHaveBeenCalledWith(
        mockUserId,
        0,
        10,
        EmailType.REPRESENTATIVE_CONTACT,
      );
    });

    it('should throw error if user not authenticated', async () => {
      await expect(
        resolver.getMyEmailHistory(mockContextNoUser as any, 0, 10),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('getMyEmail', () => {
    it('should return specific email for authenticated user', async () => {
      emailService.getEmailById = jest
        .fn()
        .mockResolvedValue(mockCorrespondence);

      const result = await resolver.getMyEmail(
        mockCorrespondence.id,
        mockContext as any,
      );

      expect(result).toEqual(mockCorrespondence);
      expect(emailService.getEmailById).toHaveBeenCalledWith(
        mockUserId,
        mockCorrespondence.id,
      );
    });

    it('should return null if email not found', async () => {
      emailService.getEmailById = jest.fn().mockResolvedValue(null);

      const result = await resolver.getMyEmail(
        'non-existent-id',
        mockContext as any,
      );

      expect(result).toBeNull();
    });

    it('should throw error if user not authenticated', async () => {
      await expect(
        resolver.getMyEmail('some-id', mockContextNoUser as any),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('getRepresentativeMailtoLink', () => {
    it('should return mailto link', async () => {
      const mockLink = 'mailto:rep@congress.gov?subject=Test&body=Hello';

      emailService.getMailtoLink = jest.fn().mockReturnValue(mockLink);

      const result = await resolver.getRepresentativeMailtoLink(
        'rep@congress.gov',
        'Test',
        'Hello',
      );

      expect(result).toBe(mockLink);
      expect(emailService.getMailtoLink).toHaveBeenCalledWith(
        'rep@congress.gov',
        'Test',
        'Hello',
      );
    });
  });

  // ============================================
  // Mutation Tests
  // ============================================

  describe('contactRepresentative', () => {
    const mockInput = {
      representativeId: 'rep-id',
      subject: 'Important Issue',
      message: 'Dear Representative, I am writing about...',
      includeAddress: true,
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

    it('should contact representative successfully', async () => {
      const mockResult = {
        success: true,
        correspondenceId: 'new-correspondence-id',
      };

      emailService.contactRepresentative = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await resolver.contactRepresentative(
        mockInput,
        mockRepresentative,
        mockProposition,
        mockContext as any,
      );

      expect(result.success).toBe(true);
      expect(result.correspondenceId).toBe('new-correspondence-id');
      expect(emailService.contactRepresentative).toHaveBeenCalledWith(
        mockUserId,
        mockUserEmail,
        mockInput,
        {
          id: mockRepresentative.id,
          name: mockRepresentative.name,
          email: mockRepresentative.email,
          chamber: mockRepresentative.chamber,
        },
        {
          id: mockProposition.id,
          title: mockProposition.title,
        },
      );
    });

    it('should handle contact without proposition', async () => {
      const mockResult = {
        success: true,
        correspondenceId: 'new-correspondence-id',
      };

      emailService.contactRepresentative = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await resolver.contactRepresentative(
        mockInput,
        mockRepresentative,
        null as any,
        mockContext as any,
      );

      expect(result.success).toBe(true);
      expect(emailService.contactRepresentative).toHaveBeenCalledWith(
        mockUserId,
        mockUserEmail,
        mockInput,
        expect.any(Object),
        undefined,
      );
    });

    it('should return error on service failure', async () => {
      emailService.contactRepresentative = jest
        .fn()
        .mockRejectedValue(new Error('Consent not granted'));

      const result = await resolver.contactRepresentative(
        mockInput,
        mockRepresentative,
        null as any,
        mockContext as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Consent not granted');
    });

    it('should throw error if user not authenticated', async () => {
      await expect(
        resolver.contactRepresentative(
          mockInput,
          mockRepresentative,
          null as any,
          mockContextNoUser as any,
        ),
      ).rejects.toThrow('User not authenticated');
    });
  });
});
