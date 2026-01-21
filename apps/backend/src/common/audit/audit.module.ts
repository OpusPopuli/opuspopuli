import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';

import { AuditLogService } from '../services/audit-log.service';
import { GraphQLAuditInterceptor } from '../interceptors/graphql-audit.interceptor';

// RelationalDbModule is global, no need to import

export const AUDIT_CONFIG = 'AUDIT_CONFIG';

export interface AuditModuleOptions {
  /**
   * Whether to enable the GraphQL audit interceptor globally
   * Default: true
   */
  enableInterceptor?: boolean;

  /**
   * Number of days to retain audit logs (0 = indefinite)
   * Default: 90 days
   */
  retentionDays?: number;

  /**
   * How often to run cleanup in milliseconds
   * Default: 24 hours (86400000ms)
   */
  cleanupIntervalMs?: number;
}

@Global()
@Module({})
export class AuditModule {
  static forRoot(options: AuditModuleOptions = {}): DynamicModule {
    const { enableInterceptor = true } = options;

    const providers: Provider[] = [
      {
        provide: AUDIT_CONFIG,
        useFactory: (configService: ConfigService) => ({
          retentionDays:
            options.retentionDays ??
            Number.parseInt(
              configService.get('AUDIT_RETENTION_DAYS') || '90',
              10,
            ),
          cleanupIntervalMs:
            options.cleanupIntervalMs ??
            Number.parseInt(
              configService.get('AUDIT_CLEANUP_INTERVAL_MS') || '86400000',
              10,
            ),
        }),
        inject: [ConfigService],
      },
      AuditLogService,
    ];

    if (enableInterceptor) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useFactory: (
          reflector: Reflector,
          auditLogService: AuditLogService,
          configService: ConfigService,
        ) =>
          new GraphQLAuditInterceptor(
            reflector,
            auditLogService,
            configService,
          ),
        inject: [Reflector, AuditLogService, ConfigService],
      });
    }

    return {
      module: AuditModule,
      imports: [ConfigModule],
      providers,
      exports: [AuditLogService],
    };
  }
}
