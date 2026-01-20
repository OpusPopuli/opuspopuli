import { Resolver, Query, Mutation, Args, Context, ID } from '@nestjs/graphql';

import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';

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
import { UserProfileModel } from './models/user-profile.model';
import { UserAddressModel } from './models/user-address.model';
import { NotificationPreferenceModel } from './models/notification-preference.model';
import { UserConsentModel } from './models/user-consent.model';

@Resolver()
export class ProfileResolver {
  constructor(private readonly profileService: ProfileService) {}

  // ============================================
  // Profile Queries & Mutations
  // ============================================

  @Query(() => UserProfileModel, { nullable: true, name: 'myProfile' })
  async getMyProfile(
    @Context() context: GqlContext,
  ): Promise<UserProfileModel | null> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.getProfile(user.id);
    return profile as UserProfileModel | null;
  }

  @Mutation(() => UserProfileModel)
  async updateMyProfile(
    @Args('input') input: UpdateProfileDto,
    @Context() context: GqlContext,
  ): Promise<UserProfileModel> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.updateProfile(user.id, input);
    return profile as unknown as UserProfileModel;
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

  @Mutation(() => UserProfileModel)
  async updateAvatarStorageKey(
    @Args('storageKey') storageKey: string,
    @Context() context: GqlContext,
  ): Promise<UserProfileModel> {
    const user = getUserFromContext(context);
    const profile = await this.profileService.updateAvatarStorageKey(
      user.id,
      storageKey,
    );
    return profile as unknown as UserProfileModel;
  }

  // ============================================
  // Address Queries & Mutations
  // ============================================

  @Query(() => [UserAddressModel], { name: 'myAddresses' })
  async getMyAddresses(
    @Context() context: GqlContext,
  ): Promise<UserAddressModel[]> {
    const user = getUserFromContext(context);
    const addresses = await this.profileService.getAddresses(user.id);
    return addresses as unknown as UserAddressModel[];
  }

  @Query(() => UserAddressModel, { nullable: true, name: 'myAddress' })
  async getMyAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressModel | null> {
    const user = getUserFromContext(context);
    const address = await this.profileService.getAddress(user.id, id);
    return address as UserAddressModel | null;
  }

  @Mutation(() => UserAddressModel)
  async createAddress(
    @Args('input') input: CreateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressModel> {
    const user = getUserFromContext(context);
    const address = await this.profileService.createAddress(user.id, input);
    return address as unknown as UserAddressModel;
  }

  @Mutation(() => UserAddressModel)
  async updateAddress(
    @Args('input') input: UpdateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressModel> {
    const user = getUserFromContext(context);
    const address = await this.profileService.updateAddress(user.id, input);
    return address as unknown as UserAddressModel;
  }

  @Mutation(() => Boolean)
  async deleteAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.profileService.deleteAddress(user.id, id);
  }

  @Mutation(() => UserAddressModel)
  async setPrimaryAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressModel> {
    const user = getUserFromContext(context);
    const address = await this.profileService.setPrimaryAddress(user.id, id);
    return address as unknown as UserAddressModel;
  }

  // ============================================
  // Notification Preferences Queries & Mutations
  // ============================================

  @Query(() => NotificationPreferenceModel, {
    nullable: true,
    name: 'myNotificationPreferences',
  })
  async getMyNotificationPreferences(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceModel | null> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.getNotificationPreferences(user.id);
    return prefs as NotificationPreferenceModel | null;
  }

  @Mutation(() => NotificationPreferenceModel)
  async updateNotificationPreferences(
    @Args('input') input: UpdateNotificationPreferencesDto,
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceModel> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.updateNotificationPreferences(
      user.id,
      input,
    );
    return prefs as unknown as NotificationPreferenceModel;
  }

  @Mutation(() => NotificationPreferenceModel)
  async unsubscribeFromAll(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceModel> {
    const user = getUserFromContext(context);
    const prefs = await this.profileService.unsubscribeAll(user.id);
    return prefs as unknown as NotificationPreferenceModel;
  }

  // ============================================
  // Consent Queries & Mutations
  // ============================================

  @Query(() => [UserConsentModel], { name: 'myConsents' })
  async getMyConsents(
    @Context() context: GqlContext,
  ): Promise<UserConsentModel[]> {
    const user = getUserFromContext(context);
    const consents = await this.profileService.getConsents(user.id);
    return consents as unknown as UserConsentModel[];
  }

  @Query(() => UserConsentModel, { nullable: true, name: 'myConsent' })
  async getMyConsent(
    @Args('consentType', { type: () => ConsentType }) consentType: ConsentType,
    @Context() context: GqlContext,
  ): Promise<UserConsentModel | null> {
    const user = getUserFromContext(context);
    const consent = await this.profileService.getConsent(user.id, consentType);
    return consent as UserConsentModel | null;
  }

  @Mutation(() => UserConsentModel)
  async updateConsent(
    @Args('input') input: UpdateConsentDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentModel> {
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
    return consent as unknown as UserConsentModel;
  }

  @Mutation(() => [UserConsentModel])
  async bulkUpdateConsents(
    @Args('input') input: BulkUpdateConsentsDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentModel[]> {
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
    return consents as unknown as UserConsentModel[];
  }

  @Mutation(() => UserConsentModel)
  async withdrawConsent(
    @Args('input') input: WithdrawConsentDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentModel> {
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
    return consent as unknown as UserConsentModel;
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
