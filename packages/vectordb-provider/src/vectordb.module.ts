import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { IVectorDBProvider } from "@opuspopuli/common";
import { PgVectorProvider } from "./providers/pgvector.provider.js";

/**
 * Vector Database Module
 *
 * Configures Dependency Injection for vector database providers.
 * Uses PostgreSQL with pgvector extension (consolidates with Supabase).
 *
 * To add custom providers, implement IVectorDBProvider interface.
 */
@Module({
  providers: [
    {
      provide: "VECTOR_DB_PROVIDER",
      useFactory: async (
        configService: ConfigService,
      ): Promise<IVectorDBProvider> => {
        const dimensions =
          configService.get<number>("vectordb.dimensions") || 384;
        const project = configService.get<string>("project") || "default";
        const collectionName = `${project}_embeddings`;

        // Use PostgreSQL with pgvector extension
        // Uses vectordb.postgres.* config, falls back to relationaldb.postgres.* for convenience
        const dataSource = new DataSource({
          type: "postgres",
          host:
            configService.get<string>("vectordb.postgres.host") ||
            configService.get<string>("relationaldb.postgres.host") ||
            "localhost",
          port:
            configService.get<number>("vectordb.postgres.port") ||
            configService.get<number>("relationaldb.postgres.port") ||
            5432,
          database:
            configService.get<string>("vectordb.postgres.database") ||
            configService.get<string>("relationaldb.postgres.database") ||
            "postgres",
          username:
            configService.get<string>("vectordb.postgres.username") ||
            configService.get<string>("relationaldb.postgres.username") ||
            "postgres",
          password:
            configService.get<string>("vectordb.postgres.password") ||
            configService.get<string>("relationaldb.postgres.password") ||
            "postgres",
          ssl:
            (configService.get<boolean>("vectordb.postgres.ssl") ??
            configService.get<boolean>("relationaldb.postgres.ssl"))
              ? { rejectUnauthorized: false }
              : false,
          synchronize: false, // We handle schema ourselves
          logging: configService.get<string>("NODE_ENV") !== "production",
        });

        // Initialize the data source
        await dataSource.initialize();

        const vectorDBProvider = new PgVectorProvider(
          dataSource,
          collectionName,
          dimensions,
        );

        // Initialize the provider (creates tables/collections)
        await vectorDBProvider.initialize();

        return vectorDBProvider;
      },
      inject: [ConfigService],
    },
  ],
  exports: ["VECTOR_DB_PROVIDER"],
})
export class VectorDBModule {}
