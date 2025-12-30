import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule as EmailProviderModule } from '@qckstrt/email-provider';

import { EmailCorrespondenceEntity } from 'src/db/entities/email-correspondence.entity';
import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { UserConsentEntity } from 'src/db/entities/user-consent.entity';

import { EmailService } from './email.service';
import { EmailResolver } from './email.resolver';

@Module({
  imports: [
    EmailProviderModule,
    TypeOrmModule.forFeature([
      EmailCorrespondenceEntity,
      UserProfileEntity,
      UserAddressEntity,
      UserConsentEntity,
    ]),
  ],
  providers: [EmailService, EmailResolver],
  exports: [EmailService],
})
export class EmailDomainModule {}
