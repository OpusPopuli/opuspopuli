import { Module, forwardRef } from '@nestjs/common';

import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

// PrismaModule is global, no need to import
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [UsersResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
