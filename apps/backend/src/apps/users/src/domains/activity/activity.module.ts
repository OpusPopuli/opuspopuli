import { Module } from '@nestjs/common';

// RelationalDbModule is global, no need to import

import { ActivityService } from './activity.service';
import { ActivityResolver } from './activity.resolver';

@Module({
  providers: [ActivityService, ActivityResolver],
  exports: [ActivityService],
})
export class ActivityModule {}
