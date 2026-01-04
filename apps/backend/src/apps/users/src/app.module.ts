import {
  ApolloFederationDriver,
  ApolloFederationDriverConfig,
} from '@nestjs/apollo';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { LoggingModule } from '@qckstrt/logging-provider';
import depthLimit from 'graphql-depth-limit';
import { createQueryComplexityValidationRule } from 'src/common/graphql/query-complexity.plugin';

import { AuthModule } from './domains/auth/auth.module';
import { UsersModule } from './domains/user/users.module';
import { ProfileModule } from './domains/profile/profile.module';
import { ActivityModule } from './domains/activity/activity.module';
import { EmailDomainModule } from './domains/email/email.module';

import configuration from 'src/config';
import supabaseConfig from 'src/config/supabase.config';
import storageConfig from 'src/config/storage.config';
import authConfig from 'src/config/auth.config';
import secretsConfig from 'src/config/secrets.config';
import relationaldbConfig from 'src/config/relationaldb.config';
import emailConfig from 'src/config/email.config';
import authThrottleConfig from 'src/config/auth-throttle.config';

import { LoggerMiddleware } from 'src/common/middleware/logger.middleware';
import { HMACMiddleware } from 'src/common/middleware/hmac.middleware';
import {
  THROTTLER_CONFIG,
  SHARED_PROVIDERS,
  createLoggingConfig,
} from 'src/common/config/shared-app.config';
import { DbModule } from 'src/db/db.module';
import { UserEntity } from 'src/db/entities/user.entity';
import { AuditLogEntity } from 'src/db/entities/audit-log.entity';
import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import { UserLoginEntity } from 'src/db/entities/user-login.entity';
import { UserSessionEntity } from 'src/db/entities/user-session.entity';
import { UserAddressEntity } from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import { UserConsentEntity } from 'src/db/entities/user-consent.entity';
import { PasskeyCredentialEntity } from 'src/db/entities/passkey-credential.entity';
import { WebAuthnChallengeEntity } from 'src/db/entities/webauthn-challenge.entity';
import { EmailCorrespondenceEntity } from 'src/db/entities/email-correspondence.entity';
import { AuditModule } from 'src/common/audit/audit.module';
import { CaslModule } from 'src/permissions/casl.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [
        configuration,
        supabaseConfig,
        storageConfig,
        authConfig,
        secretsConfig,
        relationaldbConfig,
        emailConfig,
        authThrottleConfig,
      ],
      isGlobal: true,
    }),
    LoggingModule.forRootAsync(createLoggingConfig('users-service')),
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    DbModule.forRoot({
      entities: [
        UserEntity,
        AuditLogEntity,
        UserProfileEntity,
        UserLoginEntity,
        UserSessionEntity,
        UserAddressEntity,
        NotificationPreferenceEntity,
        UserConsentEntity,
        PasskeyCredentialEntity,
        WebAuthnChallengeEntity,
        EmailCorrespondenceEntity,
      ],
    }),
    AuditModule.forRoot(),
    GraphQLModule.forRoot<ApolloFederationDriverConfig>({
      driver: ApolloFederationDriver,
      autoSchemaFile: { path: 'schema.gql', federation: 2 },
      plugins: [ApolloServerPluginInlineTrace()],
      validationRules: [depthLimit(10), createQueryComplexityValidationRule()],
    }),
    CaslModule.forRoot(),
    UsersModule,
    AuthModule,
    ProfileModule,
    ActivityModule,
    EmailDomainModule,
  ],
  providers: SHARED_PROVIDERS,
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      // SECURITY: Validate HMAC signature from API Gateway
      // Only requests signed by the gateway are accepted
      // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/185
      .apply(HMACMiddleware, LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
