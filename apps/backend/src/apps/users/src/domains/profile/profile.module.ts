import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '@qckstrt/storage-provider';

import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import { UserConsentEntity } from 'src/db/entities/user-consent.entity';

import { ProfileService } from './profile.service';
import { ProfileResolver } from './profile.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserProfileEntity,
      UserAddressEntity,
      NotificationPreferenceEntity,
      UserConsentEntity,
    ]),
    StorageModule,
  ],
  providers: [ProfileService, ProfileResolver],
  exports: [ProfileService],
})
export class ProfileModule {}
