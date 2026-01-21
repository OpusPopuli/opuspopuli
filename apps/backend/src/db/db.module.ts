import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RelationalDbModule } from '@qckstrt/relationaldb-provider';

import configuration from 'src/config';

/**
 * Database Module
 *
 * Provides ORM configuration for relational database access.
 * Uses PostgreSQL via Supabase (includes pgvector for vectors).
 *
 * The database module is global and handles connection management
 * including graceful shutdown.
 */
@Module({})
export class DbModule {
  public static forRoot(): DynamicModule {
    return {
      module: DbModule,
      imports: [
        ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
        RelationalDbModule,
      ],
      controllers: [],
      providers: [],
      exports: [],
    };
  }
}
