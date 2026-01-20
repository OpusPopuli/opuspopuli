import { Module } from '@nestjs/common';
import { StorageModule } from '@qckstrt/storage-provider';

// PrismaModule is global, no need to import

import { ProfileService } from './profile.service';
import { ProfileResolver } from './profile.resolver';

@Module({
  imports: [StorageModule],
  providers: [ProfileService, ProfileResolver],
  exports: [ProfileService],
})
export class ProfileModule {}
