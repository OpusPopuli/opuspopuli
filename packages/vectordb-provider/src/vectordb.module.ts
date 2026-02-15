import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IVectorDBProvider } from "@opuspopuli/common";
import { DbService } from "@opuspopuli/relationaldb-provider";
import { PgVectorProvider } from "./providers/pgvector.provider.js";

/**
 * Vector Database Module
 *
 * Configures Dependency Injection for vector database providers.
 * Uses PostgreSQL with pgvector extension via the shared DbService connection.
 *
 * To add custom providers, implement IVectorDBProvider interface.
 */
@Module({
  providers: [
    {
      provide: "VECTOR_DB_PROVIDER",
      useFactory: async (
        configService: ConfigService,
        dbService: DbService,
      ): Promise<IVectorDBProvider> => {
        const dimensions =
          configService.get<number>("vectordb.dimensions") || 384;
        const project = configService.get<string>("project") || "default";
        const collectionName = `${project}_embeddings`;

        const vectorDBProvider = new PgVectorProvider(
          dbService,
          collectionName,
          dimensions,
        );

        // Initialize the provider (creates tables/collections)
        await vectorDBProvider.initialize();

        return vectorDBProvider;
      },
      inject: [ConfigService, DbService],
    },
  ],
  exports: ["VECTOR_DB_PROVIDER"],
})
export class VectorDBModule {}
