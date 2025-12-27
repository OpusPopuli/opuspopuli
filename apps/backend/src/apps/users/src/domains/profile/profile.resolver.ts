import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, Context, ID } from '@nestjs/graphql';
import { UserInputError } from '@nestjs/apollo';

import { AuthGuard } from 'src/common/guards/auth.guard';

import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import {
  UserConsentEntity,
  ConsentType,
} from 'src/db/entities/user-consent.entity';

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

interface GqlContext {
  req: {
    ip?: string;
    headers: {
      user?: string;
      'user-agent'?: string;
    };
  };
}

interface UserHeader {
  id: string;
  email: string;
}

function getUserFromContext(context: GqlContext): UserHeader {
  const userHeader = context.req.headers.user;
  if (!userHeader) {
    throw new UserInputError('User not authenticated');
  }
  return JSON.parse(userHeader);
}

@Resolver()
export class ProfileResolver {
  constructor(private readonly profileService: ProfileService) {}

  // ============================================
  // Profile Queries & Mutations
  // ============================================

  @Query(() => UserProfileEntity, { nullable: true, name: 'myProfile' })
  @UseGuards(AuthGuard)
  async getMyProfile(
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity | null> {
    const user = getUserFromContext(context);
    return this.profileService.getProfile(user.id);
  }

  @Mutation(() => UserProfileEntity)
  @UseGuards(AuthGuard)
  async updateMyProfile(
    @Args('input') input: UpdateProfileDto,
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity> {
    const user = getUserFromContext(context);
    return this.profileService.updateProfile(user.id, input);
  }

  // ============================================
  // Profile Completion Queries
  // ============================================

  @Query(() => ProfileCompletionResult, { name: 'myProfileCompletion' })
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  async getAvatarUploadUrl(
    @Args('filename') filename: string,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.profileService.getAvatarUploadUrl(user.id, filename);
  }

  @Mutation(() => UserProfileEntity)
  @UseGuards(AuthGuard)
  async updateAvatarStorageKey(
    @Args('storageKey') storageKey: string,
    @Context() context: GqlContext,
  ): Promise<UserProfileEntity> {
    const user = getUserFromContext(context);
    return this.profileService.updateAvatarStorageKey(user.id, storageKey);
  }

  // ============================================
  // Address Queries & Mutations
  // ============================================

  @Query(() => [UserAddressEntity], { name: 'myAddresses' })
  @UseGuards(AuthGuard)
  async getMyAddresses(
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity[]> {
    const user = getUserFromContext(context);
    return this.profileService.getAddresses(user.id);
  }

  @Query(() => UserAddressEntity, { nullable: true, name: 'myAddress' })
  @UseGuards(AuthGuard)
  async getMyAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity | null> {
    const user = getUserFromContext(context);
    return this.profileService.getAddress(user.id, id);
  }

  @Mutation(() => UserAddressEntity)
  @UseGuards(AuthGuard)
  async createAddress(
    @Args('input') input: CreateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    return this.profileService.createAddress(user.id, input);
  }

  @Mutation(() => UserAddressEntity)
  @UseGuards(AuthGuard)
  async updateAddress(
    @Args('input') input: UpdateAddressDto,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    return this.profileService.updateAddress(user.id, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async deleteAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.profileService.deleteAddress(user.id, id);
  }

  @Mutation(() => UserAddressEntity)
  @UseGuards(AuthGuard)
  async setPrimaryAddress(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<UserAddressEntity> {
    const user = getUserFromContext(context);
    return this.profileService.setPrimaryAddress(user.id, id);
  }

  // ============================================
  // Notification Preferences Queries & Mutations
  // ============================================

  @Query(() => NotificationPreferenceEntity, {
    nullable: true,
    name: 'myNotificationPreferences',
  })
  @UseGuards(AuthGuard)
  async getMyNotificationPreferences(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity | null> {
    const user = getUserFromContext(context);
    return this.profileService.getNotificationPreferences(user.id);
  }

  @Mutation(() => NotificationPreferenceEntity)
  @UseGuards(AuthGuard)
  async updateNotificationPreferences(
    @Args('input') input: UpdateNotificationPreferencesDto,
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity> {
    const user = getUserFromContext(context);
    return this.profileService.updateNotificationPreferences(user.id, input);
  }

  @Mutation(() => NotificationPreferenceEntity)
  @UseGuards(AuthGuard)
  async unsubscribeFromAll(
    @Context() context: GqlContext,
  ): Promise<NotificationPreferenceEntity> {
    const user = getUserFromContext(context);
    return this.profileService.unsubscribeAll(user.id);
  }

  // ============================================
  // Consent Queries & Mutations
  // ============================================

  @Query(() => [UserConsentEntity], { name: 'myConsents' })
  @UseGuards(AuthGuard)
  async getMyConsents(
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity[]> {
    const user = getUserFromContext(context);
    return this.profileService.getConsents(user.id);
  }

  @Query(() => UserConsentEntity, { nullable: true, name: 'myConsent' })
  @UseGuards(AuthGuard)
  async getMyConsent(
    @Args('consentType', { type: () => ConsentType }) consentType: ConsentType,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity | null> {
    const user = getUserFromContext(context);
    return this.profileService.getConsent(user.id, consentType);
  }

  @Mutation(() => UserConsentEntity)
  @UseGuards(AuthGuard)
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
    return this.profileService.updateConsent(user.id, input, metadata);
  }

  @Mutation(() => [UserConsentEntity])
  @UseGuards(AuthGuard)
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
    return this.profileService.bulkUpdateConsents(
      user.id,
      input.consents,
      metadata,
    );
  }

  @Mutation(() => UserConsentEntity)
  @UseGuards(AuthGuard)
  async withdrawConsent(
    @Args('input') input: WithdrawConsentDto,
    @Context() context: GqlContext,
  ): Promise<UserConsentEntity> {
    const user = getUserFromContext(context);
    const metadata = {
      ipAddress: context.req?.ip,
      userAgent: context.req?.headers?.['user-agent'],
    };
    return this.profileService.withdrawConsent(
      user.id,
      input.consentType,
      metadata,
    );
  }

  @Query(() => Boolean)
  @UseGuards(AuthGuard)
  async hasValidConsent(
    @Args('consentType', { type: () => ConsentType }) consentType: ConsentType,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.profileService.hasValidConsent(user.id, consentType);
  }
}
