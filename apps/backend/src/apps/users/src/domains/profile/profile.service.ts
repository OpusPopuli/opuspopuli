import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@qckstrt/storage-provider';
import {
  DbService,
  UserProfile as DbUserProfile,
  UserAddress as DbUserAddress,
  NotificationPreference as DbNotificationPreference,
  UserConsent as DbUserConsent,
  Prisma,
} from '@qckstrt/relationaldb-provider';
import { IFileConfig } from 'src/config';
import { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import { UpdateConsentDto } from './dto/consent.dto';
import { ProfileCompletionResult } from './models/profile-completion.model';

@Injectable()
export class ProfileService {
  private fileConfig?: IFileConfig;

  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject('STORAGE_PROVIDER')
    private readonly storage?: IStorageProvider,
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.fileConfig = configService?.get<IFileConfig>('file');
  }

  // ============================================
  // Profile Methods
  // ============================================

  async getProfile(userId: string): Promise<DbUserProfile | null> {
    return this.db.userProfile.findUnique({ where: { userId } });
  }

  async getOrCreateProfile(userId: string): Promise<DbUserProfile> {
    let profile = await this.db.userProfile.findUnique({
      where: { userId },
    });
    profile ??= await this.db.userProfile.create({
      data: { userId },
    });
    return profile;
  }

  async updateProfile(
    userId: string,
    updateDto: UpdateProfileDto,
  ): Promise<DbUserProfile> {
    await this.getOrCreateProfile(userId);

    // Cast to database type - enum values are compatible at runtime
    return this.db.userProfile.update({
      where: { userId },
      data: updateDto as Prisma.UserProfileUpdateInput,
    });
  }

  // ============================================
  // Profile Completion Methods
  // ============================================

  async getProfileCompletion(userId: string): Promise<ProfileCompletionResult> {
    const profile = await this.getProfile(userId);
    const addresses = await this.getAddresses(userId);

    // Core fields: Name + Photo + Timezone + Address = 100% when complete
    const coreFieldsComplete = {
      hasName: !!(profile?.firstName || profile?.displayName),
      hasPhoto: !!(profile?.avatarUrl || profile?.avatarStorageKey),
      hasTimezone: !!profile?.timezone,
      hasAddress: addresses.length > 0,
    };

    const coreComplete = Object.values(coreFieldsComplete).every(Boolean);

    // Calculate weighted percentage
    // Core fields: 25% each = 100% when all complete
    let percentage = 0;
    if (coreFieldsComplete.hasName) percentage += 25;
    if (coreFieldsComplete.hasPhoto) percentage += 25;
    if (coreFieldsComplete.hasTimezone) percentage += 25;
    if (coreFieldsComplete.hasAddress) percentage += 25;

    // Civic fields bonus (up to 15%): 5% each
    const civicFieldsCount = [
      profile?.politicalAffiliation,
      profile?.votingFrequency,
      profile?.policyPriorities && profile.policyPriorities.length > 0,
    ].filter(Boolean).length;
    percentage += Math.min(civicFieldsCount * 5, 15);

    // Demographic fields bonus (up to 15%): 3% each
    const demographicFieldsCount = [
      profile?.occupation,
      profile?.educationLevel,
      profile?.incomeRange,
      profile?.householdSize,
      profile?.homeownerStatus,
    ].filter(Boolean).length;
    percentage += Math.min(demographicFieldsCount * 3, 15);

    return {
      percentage: Math.min(percentage, 130), // Cap at 130% (100% core + 30% bonus)
      isComplete: coreComplete,
      coreFieldsComplete,
      suggestedNextSteps: this.getSuggestedSteps(coreFieldsComplete, profile),
    };
  }

  private getSuggestedSteps(
    coreFieldsComplete: {
      hasName: boolean;
      hasPhoto: boolean;
      hasTimezone: boolean;
      hasAddress: boolean;
    },
    profile: DbUserProfile | null,
  ): string[] {
    const steps: string[] = [];

    if (!coreFieldsComplete.hasName) {
      steps.push('Add your name to personalize your profile');
    }
    if (!coreFieldsComplete.hasPhoto) {
      steps.push('Upload a profile photo');
    }
    if (!coreFieldsComplete.hasTimezone) {
      steps.push('Set your timezone for accurate notifications');
    }
    if (!coreFieldsComplete.hasAddress) {
      steps.push('Add an address to see relevant ballot information');
    }

    // Suggest civic fields if core is complete
    if (Object.values(coreFieldsComplete).every(Boolean)) {
      if (!profile?.politicalAffiliation) {
        steps.push(
          'Share your political affiliation for personalized insights',
        );
      }
      if (!profile?.votingFrequency) {
        steps.push('Tell us how often you vote');
      }
      if (!profile?.policyPriorities || profile.policyPriorities.length === 0) {
        steps.push('Select your policy priorities');
      }
    }

    return steps.slice(0, 3); // Return max 3 suggestions
  }

  // ============================================
  // Avatar Upload Methods
  // ============================================

  async getAvatarUploadUrl(userId: string, filename: string): Promise<string> {
    if (!this.storage || !this.fileConfig) {
      throw new Error('Storage provider not configured');
    }

    const key = `avatars/${userId}/${filename}`;
    return this.storage.getSignedUrl(this.fileConfig.bucket, key, true);
  }

  async updateAvatarStorageKey(
    userId: string,
    storageKey: string,
  ): Promise<DbUserProfile> {
    const profile = await this.getOrCreateProfile(userId);

    // Generate a download URL for the avatar
    let avatarUrl: string | undefined;
    if (this.storage && this.fileConfig) {
      try {
        avatarUrl = await this.storage.getSignedUrl(
          this.fileConfig.bucket,
          storageKey,
          false,
        );
      } catch {
        // If we can't get a signed URL, store the storage key as a fallback
        avatarUrl = storageKey;
      }
    }

    return this.db.userProfile.update({
      where: { id: profile.id },
      data: {
        avatarStorageKey: storageKey,
        avatarUrl,
      },
    });
  }

  // ============================================
  // Address Methods
  // ============================================

  async getAddresses(userId: string): Promise<DbUserAddress[]> {
    return this.db.userAddress.findMany({
      where: { userId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getAddress(
    userId: string,
    addressId: string,
  ): Promise<DbUserAddress | null> {
    return this.db.userAddress.findFirst({
      where: { id: addressId, userId },
    });
  }

  async createAddress(
    userId: string,
    createDto: CreateAddressDto,
  ): Promise<DbUserAddress> {
    // If this is marked as primary, unset other primary addresses
    if (createDto.isPrimary) {
      await this.db.userAddress.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.db.userAddress.create({
      data: {
        userId,
        ...createDto,
      },
    });
  }

  async updateAddress(
    userId: string,
    updateDto: UpdateAddressDto,
  ): Promise<DbUserAddress> {
    const address = await this.db.userAddress.findFirst({
      where: { id: updateDto.id, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // If this is being marked as primary, unset other primary addresses
    if (updateDto.isPrimary) {
      await this.db.userAddress.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    // Update only provided fields (excluding id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...updateData } = updateDto;

    return this.db.userAddress.update({
      where: { id: address.id },
      data: updateData,
    });
  }

  async deleteAddress(userId: string, addressId: string): Promise<boolean> {
    const result = await this.db.userAddress.deleteMany({
      where: { id: addressId, userId },
    });
    return result.count > 0;
  }

  async setPrimaryAddress(
    userId: string,
    addressId: string,
  ): Promise<DbUserAddress> {
    const address = await this.db.userAddress.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Unset all other primary addresses
    await this.db.userAddress.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });

    // Set this one as primary
    return this.db.userAddress.update({
      where: { id: address.id },
      data: { isPrimary: true },
    });
  }

  // ============================================
  // Notification Preferences Methods
  // ============================================

  async getNotificationPreferences(
    userId: string,
  ): Promise<DbNotificationPreference | null> {
    return this.db.notificationPreference.findUnique({ where: { userId } });
  }

  async getOrCreateNotificationPreferences(
    userId: string,
  ): Promise<DbNotificationPreference> {
    let prefs = await this.db.notificationPreference.findUnique({
      where: { userId },
    });
    prefs ??= await this.db.notificationPreference.create({
      data: { userId },
    });
    return prefs;
  }

  async updateNotificationPreferences(
    userId: string,
    updateDto: UpdateNotificationPreferencesDto,
  ): Promise<DbNotificationPreference> {
    await this.getOrCreateNotificationPreferences(userId);

    return this.db.notificationPreference.update({
      where: { userId },
      data: updateDto,
    });
  }

  async unsubscribeAll(userId: string): Promise<DbNotificationPreference> {
    await this.getOrCreateNotificationPreferences(userId);

    return this.db.notificationPreference.update({
      where: { userId },
      data: {
        emailEnabled: false,
        pushEnabled: false,
        smsEnabled: false,
        unsubscribedAllAt: new Date(),
      },
    });
  }

  // ============================================
  // Consent Methods
  // ============================================

  async getConsents(userId: string): Promise<DbUserConsent[]> {
    return this.db.userConsent.findMany({
      where: { userId },
      orderBy: { consentType: 'asc' },
    });
  }

  async getConsent(
    userId: string,
    consentType: ConsentType,
  ): Promise<DbUserConsent | null> {
    return this.db.userConsent.findUnique({
      where: { userId_consentType: { userId, consentType } },
    });
  }

  async updateConsent(
    userId: string,
    updateDto: UpdateConsentDto,
    metadata: {
      ipAddress?: string;
      userAgent?: string;
      collectionMethod?: string;
    } = {},
  ): Promise<DbUserConsent> {
    const now = new Date();

    const data = {
      status: updateDto.granted ? ConsentStatus.GRANTED : ConsentStatus.DENIED,
      grantedAt: updateDto.granted ? now : null,
      deniedAt: updateDto.granted ? null : now,
      withdrawnAt: null,
      documentVersion: updateDto.documentVersion,
      documentUrl: updateDto.documentUrl,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      collectionMethod: metadata.collectionMethod,
    };

    return this.db.userConsent.upsert({
      where: {
        userId_consentType: { userId, consentType: updateDto.consentType },
      },
      update: data,
      create: {
        userId,
        consentType: updateDto.consentType,
        ...data,
      },
    });
  }

  async bulkUpdateConsents(
    userId: string,
    consents: UpdateConsentDto[],
    metadata: {
      ipAddress?: string;
      userAgent?: string;
      collectionMethod?: string;
    } = {},
  ): Promise<DbUserConsent[]> {
    const results: DbUserConsent[] = [];

    for (const consentDto of consents) {
      const result = await this.updateConsent(userId, consentDto, metadata);
      results.push(result);
    }

    return results;
  }

  async withdrawConsent(
    userId: string,
    consentType: ConsentType,
    metadata: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<DbUserConsent> {
    const consent = await this.db.userConsent.findUnique({
      where: { userId_consentType: { userId, consentType } },
    });

    if (!consent) {
      throw new NotFoundException('Consent record not found');
    }

    return this.db.userConsent.update({
      where: { id: consent.id },
      data: {
        status: ConsentStatus.WITHDRAWN,
        withdrawnAt: new Date(),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });
  }

  async hasValidConsent(
    userId: string,
    consentType: ConsentType,
  ): Promise<boolean> {
    const consent = await this.db.userConsent.findFirst({
      where: { userId, consentType, status: ConsentStatus.GRANTED },
    });

    if (!consent) return false;

    // Check if consent has expired
    if (consent.expiresAt && consent.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  async getRequiredConsentsStatus(
    userId: string,
  ): Promise<{ type: ConsentType; granted: boolean }[]> {
    const requiredTypes = [
      ConsentType.TERMS_OF_SERVICE,
      ConsentType.PRIVACY_POLICY,
    ];

    const results = await Promise.all(
      requiredTypes.map(async (type) => ({
        type,
        granted: await this.hasValidConsent(userId, type),
      })),
    );

    return results;
  }
}
