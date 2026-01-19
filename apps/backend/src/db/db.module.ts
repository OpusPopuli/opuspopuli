import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

import configuration from 'src/config';
import { DbConfigError } from './db.errors';
import {
  RelationalDBModule,
  IRelationalDBProvider,
  PostgresProvider,
  connectWithRetry,
  ConnectionRetryConfig,
} from '@qckstrt/relationaldb-provider';

interface DbEntityConfig {
  entities: DataSourceOptions['entities'];
}

// Store retry config for use in dataSourceFactory
let storedRetryConfig: ConnectionRetryConfig | undefined;

/**
 * Database Module
 *
 * Provides TypeORM configuration using pluggable database providers.
 * Uses PostgreSQL via Supabase (includes pgvector for vectors).
 *
 * Includes connection retry logic with exponential backoff for handling
 * scenarios where the database is unavailable at startup.
 */
@Module({})
export class DbModule {
  public static forRoot(dbEntityConfig: DbEntityConfig): DynamicModule {
    return {
      module: DbModule,
      imports: [
        ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
        RelationalDBModule,
        TypeOrmModule.forRootAsync({
          imports: [RelationalDBModule],
          useFactory: (
            dbProvider: IRelationalDBProvider,
          ): TypeOrmModuleOptions => {
            if (!dbProvider) {
              throw new DbConfigError('Database provider not initialized');
            }

            // Get connection options from the injected provider
            const connectionOptions = dbProvider.getConnectionOptions(
              dbEntityConfig.entities,
            );

            // Store retry config for use in dataSourceFactory
            storedRetryConfig =
              dbProvider instanceof PostgresProvider
                ? dbProvider.getRetryConfig()
                : undefined;

            return connectionOptions as TypeOrmModuleOptions;
          },
          // Custom DataSource factory with retry logic
          // Note: Type assertion needed due to different TypeORM resolution paths
          // between packages (functionally identical DataSource classes)
          dataSourceFactory: async (options) => {
            if (!options) {
              throw new DbConfigError('DataSource options not provided');
            }

            const logger = new Logger('DbConnection');
            logger.log('Initializing database connection with retry logic');

            // Use type assertions to bypass TypeORM type conflicts between packages
            // (same version, different resolution paths due to peer dependencies)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dataSource = new DataSource(options as any);

            const result = connectWithRetry(dataSource, {
              config: storedRetryConfig,
              logger,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return result as any;
          },
          inject: ['RELATIONAL_DB_PROVIDER'],
        }),
      ],
      controllers: [],
      providers: [],
      exports: [],
    };
  }
}
