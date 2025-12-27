import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IStorageProvider } from '@qckstrt/storage-provider';

import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import {
  UserConsentEntity,
  ConsentStatus,
  ConsentType,
} from 'src/db/entities/user-consent.entity';
import { IFileConfig } from 'src/config';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import { UpdateConsentDto } from './dto/consent.dto';
import { ProfileCompletionResult } from './models/profile-completion.model';

@Injectable()
export class ProfileService {
  private fileConfig?: IFileConfig;

  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly profileRepository: Repository<UserProfileEntity>,
    @InjectRepository(UserAddressEntity)
    private readonly addressRepository: Repository<UserAddressEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly notificationRepository: Repository<NotificationPreferenceEntity>,
    @InjectRepository(UserConsentEntity)
    private readonly consentRepository: Repository<UserConsentEntity>,
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

  async getProfile(userId: string): Promise<UserProfileEntity | null> {
    return this.profileRepository.findOne({ where: { userId } });
  }

  async getOrCreateProfile(userId: string): Promise<UserProfileEntity> {
    let profile = await this.profileRepository.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepository.create({ userId });
      await this.profileRepository.save(profile);
    }
    return profile;
  }

  async updateProfile(
    userId: string,
    updateDto: UpdateProfileDto,
  ): Promise<UserProfileEntity> {
    const profile = await this.getOrCreateProfile(userId);

    // Update only provided fields
    Object.assign(profile, updateDto);

    return this.profileRepository.save(profile);
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
    profile: UserProfileEntity | null,
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
  ): Promise<UserProfileEntity> {
    const profile = await this.getOrCreateProfile(userId);
    profile.avatarStorageKey = storageKey;

    // Generate a download URL for the avatar
    if (this.storage && this.fileConfig) {
      try {
        profile.avatarUrl = await this.storage.getSignedUrl(
          this.fileConfig.bucket,
          storageKey,
          false,
        );
      } catch {
        // If we can't get a signed URL, store the storage key as a fallback
        profile.avatarUrl = storageKey;
      }
    }

    return this.profileRepository.save(profile);
  }

  // ============================================
  // Address Methods
  // ============================================

  async getAddresses(userId: string): Promise<UserAddressEntity[]> {
    return this.addressRepository.find({
      where: { userId },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
  }

  async getAddress(
    userId: string,
    addressId: string,
  ): Promise<UserAddressEntity | null> {
    return this.addressRepository.findOne({
      where: { id: addressId, userId },
    });
  }

  async createAddress(
    userId: string,
    createDto: CreateAddressDto,
  ): Promise<UserAddressEntity> {
    // If this is marked as primary, unset other primary addresses
    if (createDto.isPrimary) {
      await this.addressRepository.update(
        { userId, isPrimary: true },
        { isPrimary: false },
      );
    }

    const address = this.addressRepository.create({
      userId,
      ...createDto,
    });

    return this.addressRepository.save(address);
  }

  async updateAddress(
    userId: string,
    updateDto: UpdateAddressDto,
  ): Promise<UserAddressEntity> {
    const address = await this.addressRepository.findOne({
      where: { id: updateDto.id, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // If this is being marked as primary, unset other primary addresses
    if (updateDto.isPrimary) {
      await this.addressRepository.update(
        { userId, isPrimary: true },
        { isPrimary: false },
      );
    }

    // Update only provided fields (excluding id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...updateData } = updateDto;
    Object.assign(address, updateData);

    return this.addressRepository.save(address);
  }

  async deleteAddress(userId: string, addressId: string): Promise<boolean> {
    const result = await this.addressRepository.delete({
      id: addressId,
      userId,
    });
    return result.affected !== 0;
  }

  async setPrimaryAddress(
    userId: string,
    addressId: string,
  ): Promise<UserAddressEntity> {
    const address = await this.addressRepository.findOne({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Unset all other primary addresses
    await this.addressRepository.update(
      { userId, isPrimary: true },
      { isPrimary: false },
    );

    // Set this one as primary
    address.isPrimary = true;
    return this.addressRepository.save(address);
  }

  // ============================================
  // Notification Preferences Methods
  // ============================================

  async getNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferenceEntity | null> {
    return this.notificationRepository.findOne({ where: { userId } });
  }

  async getOrCreateNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferenceEntity> {
    let prefs = await this.notificationRepository.findOne({
      where: { userId },
    });
    if (!prefs) {
      prefs = this.notificationRepository.create({ userId });
      await this.notificationRepository.save(prefs);
    }
    return prefs;
  }

  async updateNotificationPreferences(
    userId: string,
    updateDto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceEntity> {
    const prefs = await this.getOrCreateNotificationPreferences(userId);

    // Update only provided fields
    Object.assign(prefs, updateDto);

    return this.notificationRepository.save(prefs);
  }

  async unsubscribeAll(userId: string): Promise<NotificationPreferenceEntity> {
    const prefs = await this.getOrCreateNotificationPreferences(userId);

    prefs.emailEnabled = false;
    prefs.pushEnabled = false;
    prefs.smsEnabled = false;
    prefs.unsubscribedAllAt = new Date();

    return this.notificationRepository.save(prefs);
  }

  // ============================================
  // Consent Methods
  // ============================================

  async getConsents(userId: string): Promise<UserConsentEntity[]> {
    return this.consentRepository.find({
      where: { userId },
      order: { consentType: 'ASC' },
    });
  }

  async getConsent(
    userId: string,
    consentType: ConsentType,
  ): Promise<UserConsentEntity | null> {
    return this.consentRepository.findOne({
      where: { userId, consentType },
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
  ): Promise<UserConsentEntity> {
    let consent = await this.consentRepository.findOne({
      where: { userId, consentType: updateDto.consentType },
    });

    const now = new Date();

    if (!consent) {
      consent = this.consentRepository.create({
        userId,
        consentType: updateDto.consentType,
      });
    }

    // Update consent status
    if (updateDto.granted) {
      consent.status = ConsentStatus.GRANTED;
      consent.grantedAt = now;
      consent.deniedAt = undefined;
      consent.withdrawnAt = undefined;
    } else {
      consent.status = ConsentStatus.DENIED;
      consent.deniedAt = now;
      consent.grantedAt = undefined;
    }

    // Update version info if provided
    if (updateDto.documentVersion) {
      consent.documentVersion = updateDto.documentVersion;
    }
    if (updateDto.documentUrl) {
      consent.documentUrl = updateDto.documentUrl;
    }

    // Update collection metadata
    if (metadata.ipAddress) consent.ipAddress = metadata.ipAddress;
    if (metadata.userAgent) consent.userAgent = metadata.userAgent;
    if (metadata.collectionMethod)
      consent.collectionMethod = metadata.collectionMethod;

    return this.consentRepository.save(consent);
  }

  async bulkUpdateConsents(
    userId: string,
    consents: UpdateConsentDto[],
    metadata: {
      ipAddress?: string;
      userAgent?: string;
      collectionMethod?: string;
    } = {},
  ): Promise<UserConsentEntity[]> {
    const results: UserConsentEntity[] = [];

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
  ): Promise<UserConsentEntity> {
    const consent = await this.consentRepository.findOne({
      where: { userId, consentType },
    });

    if (!consent) {
      throw new NotFoundException('Consent record not found');
    }

    consent.status = ConsentStatus.WITHDRAWN;
    consent.withdrawnAt = new Date();

    if (metadata.ipAddress) consent.ipAddress = metadata.ipAddress;
    if (metadata.userAgent) consent.userAgent = metadata.userAgent;

    return this.consentRepository.save(consent);
  }

  async hasValidConsent(
    userId: string,
    consentType: ConsentType,
  ): Promise<boolean> {
    const consent = await this.consentRepository.findOne({
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
