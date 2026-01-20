import { Resolver, Query, Mutation, Args, Context, ID } from '@nestjs/graphql';

import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';

// TypeORM entities are still used as GraphQL types (they have @ObjectType decorators)
// The service now returns Prisma types which are structurally compatible
import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import { UserConsentEntity } from 'src/db/entities/user-consent.entity';
import { ConsentType } from 'src/common/enums/consent.enum';

import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import {
  UpdateConsentDto,
  BulkUpdateConsentsDto,
  WithdrawConsentDto,
} from './dto/consent.dto';
import { ProfileCompletionResult } from './models/profile-completion.model';

@Resolver()
export class ProfileResolver {
  constructor(private readonly profileService: ProfileService) {}

  // ============================================
  // Profile Queries & Mutations
  // ============================================

  @Query(() => UserProfileEntity, { nullable: true, name: 'myProfile' })
  async getMyProfile(
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity | null> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.getProfile(user.id);
    return profile as UserProfileEntity | null;
  }

  @Mutation(() => UserProfileEntity)
  async updateMyProfile(
    @Args('input') input: UpdateProfileDto,
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.updateProfile(user.id, input);
    return profile as unknown as UserProfileEntity;
  }

  // ============================================
  // Profile Completion Queries
  // ============================================

  @Query(() => ProfileCompletionResult, { name: 'myProfileCompletion' })
  async getMyProfileCompletion(
    @Context() context: GqlContext,
  ): Promise<ProfileCompletionResult> {
    const user = getUserFromContext(context);
    return this.profileService.getProfileCompletion(user.id);
  }

  // ============================================
  // Avatar Upload Queries & Mutations
  // ============================================

  @Query(() => String, { name: 'avatarUploadUrl' })
  async getAvatarUploadUrl(
    @Args('filename') filename: string,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.profileService.getAvatarUploadUrl(user.id, filename);
  }

  @Mutation(() => UserProfileEntity)
  async updateAvatarStorageKey(
    @Args('storageKey') storageKey: string,
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.updateAvatarStorageKey(
      user.id,
      storageKey,
    );
    return profile as unknown as UserProfileEntity;
  }

  // ============================================
  // Address Queries & Mutations
  // ============================================

  @Query(() => [UserAddressEntity], { name: 'myAddresses' })
  async getMyAddresses(
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity[]> {
    const user = getUserFromContext(context);
    const addresses = await this.profileService.getAddresses(user.id);
    return addresses as unknown as UserAddressEntity[];
  }

  @Query(() => UserAddressEntity, { nullable: true, name: 'myAddress' })
  async getMyAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity | null> {
    const user = getUserFromContext(context);
    const address = await this.profileService.getAddress(user.id, id);
    return address as UserAddressEntity | null;
  }

  @Mutation(() => UserAddressEntity)
  async createAddress(
    @Args('input') input: CreateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    const address = await this.profileService.createAddress(user.id, input);
    return address as unknown as UserAddressEntity;
  }

  @Mutation(() => UserAddressEntity)
  async updateAddress(
    @Args('input') input: UpdateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    const address = await this.profileService.updateAddress(user.id, input);
    return address as unknown as UserAddressEntity;
  }

  @Mutation(() => Boolean)
  async deleteAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.profileService.deleteAddress(user.id, id);
  }

  @Mutation(() => UserAddressEntity)
  async setPrimaryAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    const address = await this.profileService.setPrimaryAddress(user.id, id);
    return address as unknown as UserAddressEntity;
  }

  // ============================================
  // Notification Preferences Queries & Mutations
  // ============================================

  @Query(() => NotificationPreferenceEntity, {
    nullable: true,
    name: 'myNotificationPreferences',
  })
  async getMyNotificationPreferences(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity | null> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.getNotificationPreferences(user.id);
    return prefs as NotificationPreferenceEntity | null;
  }

  @Mutation(() => NotificationPreferenceEntity)
  async updateNotificationPreferences(
    @Args('input') input: UpdateNotificationPreferencesDto,
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.updateNotificationPreferences(
      user.id,
      input,
    );
    return prefs as unknown as NotificationPreferenceEntity;
  }

  @Mutation(() => NotificationPreferenceEntity)
  async unsubscribeFromAll(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.unsubscribeAll(user.id);
    return prefs as unknown as NotificationPreferenceEntity;
  }

  // ============================================
  // Consent Queries & Mutations
  // ============================================

  @Query(() => [UserConsentEntity], { name: 'myConsents' })
  async getMyConsents(
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity[]> {
    const user = getUserFromContext(context);
    const consents = await this.profileService.getConsents(user.id);
    return consents as unknown as UserConsentEntity[];
  }

  @Query(() => UserConsentEntity, { nullable: true, name: 'myConsent' })
  async getMyConsent(
    @Args('consentType', { type: () => ConsentType }) consentType: ConsentType,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity | null> {
    const user = getUserFromContext(context);
    const consent = await this.profileService.getConsent(user.id, consentType);
    return consent as UserConsentEntity | null;
  }

  @Mutation(() => UserConsentEntity)
  async updateConsent(
    @Args('input') input: UpdateConsentDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity> {
    const user = getUserFromContext(context);
    const metadata = {
      ipAddress: context.req?.ip,
      userAgent: context.req?.headers?.['user-agent'],
      collectionMethod: 'graphql_api',
    };
    const consent = await this.profileService.updateConsent(
      user.id,
      input,
      metadata,
    );
    return consent as unknown as UserConsentEntity;
  }

  @Mutation(() => [UserConsentEntity])
  async bulkUpdateConsents(
    @Args('input') input: BulkUpdateConsentsDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity[]> {
    const user = getUserFromContext(context);
    const metadata = {
      ipAddress: context.req?.ip,
      userAgent: context.req?.headers?.['user-agent'],
      collectionMethod: 'graphql_api',
    };
    const consents = await this.profileService.bulkUpdateConsents(
      user.id,
      input.consents,
      metadata,
    );
    return consents as unknown as UserConsentEntity[];
  }

  @Mutation(() => UserConsentEntity)
  async withdrawConsent(
    @Args('input') input: WithdrawConsentDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity> {
    const user = getUserFromContext(context);
    const metadata = {
      ipAddress: context.req?.ip,
      userAgent: context.req?.headers?.['user-agent'],
    };
    const consent = await this.profileService.withdrawConsent(
      user.id,
      input.consentType,
      metadata,
    );
    return consent as unknown as UserConsentEntity;
  }

  @Query(() => Boolean)
  async hasValidConsent(
    @Args('consentType', { type: () => ConsentType }) consentType: ConsentType,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.profileService.hasValidConsent(user.id, consentType);
  }
}
