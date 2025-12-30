import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';

import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { PasskeyService } from './services/passkey.service';
import { JwtStrategy } from 'src/common/auth/jwt.strategy';
import { UsersModule } from '../user/users.module';
import { EmailDomainModule } from '../email/email.module';
import { AuthModule as AuthProviderModule } from '@qckstrt/auth-provider';

// Entities
import { PasskeyCredentialEntity } from 'src/db/entities/passkey-credential.entity';
import { WebAuthnChallengeEntity } from 'src/db/entities/webauthn-challenge.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([
      PasskeyCredentialEntity,
      WebAuthnChallengeEntity,
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => EmailDomainModule),
    AuthProviderModule,
  ],
  providers: [AuthResolver, AuthService, PasskeyService, JwtStrategy],
  exports: [AuthService, PasskeyService],
})
export class AuthModule {}
