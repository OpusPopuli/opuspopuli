import { Module } from '@nestjs/common';
import { StorageModule } from '@opuspopuli/storage-provider';

// RelationalDbModule is global, no need to import

import { ProfileService } from './profile.service';
import { ProfileResolver } from './profile.resolver';

@Module({
  imports: [StorageModule],
  providers: [ProfileService, ProfileResolver],
  exports: [ProfileService],
})
export class ProfileModule {}
