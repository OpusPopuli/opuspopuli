import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { PasskeyService } from './services/passkey.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { JwtStrategy } from 'src/common/auth/jwt.strategy';
import { UsersModule } from '../user/users.module';
import { EmailDomainModule } from '../email/email.module';
import { AuthModule as AuthProviderModule } from '@qckstrt/auth-provider';

// PrismaModule is global, no need to import

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    forwardRef(() => UsersModule),
    forwardRef(() => EmailDomainModule),
    AuthProviderModule,
  ],
  providers: [
    AuthResolver,
    AuthService,
    PasskeyService,
    AccountLockoutService,
    JwtStrategy,
  ],
  exports: [AuthService, PasskeyService, AccountLockoutService],
})
export class AuthModule {}
