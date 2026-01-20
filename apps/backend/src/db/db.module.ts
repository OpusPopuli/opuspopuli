import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from 'src/config';
import { PrismaModule } from './prisma.module';

/**
 * Database Module
 *
 * Provides Prisma ORM configuration for database access.
 * Uses PostgreSQL via Supabase (includes pgvector for vectors).
 *
 * The PrismaModule is global and handles connection management
 * including graceful shutdown.
 */
@Module({})
export class DbModule {
  public static forRoot(): DynamicModule {
    return {
      module: DbModule,
      imports: [
        ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
        PrismaModule,
      ],
      controllers: [],
      providers: [],
      exports: [],
    };
  }
}
