import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EMBEDDING_DIMENSIONS, IVectorDBProvider } from "@opuspopuli/common";
import { vectordbConfig } from "@opuspopuli/config-provider";
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
  imports: [ConfigModule.forFeature(vectordbConfig)],
  providers: [
    {
      provide: "VECTOR_DB_PROVIDER",
      useFactory: async (
        configService: ConfigService,
        dbService: DbService,
      ): Promise<IVectorDBProvider> => {
        // Falls back to the cutover width, not MiniLM's 384: a fallback that
        // fires should produce a table the running model can actually use.
        const dimensions =
          configService.get<number>("vectordb.dimensions") ||
          EMBEDDING_DIMENSIONS;
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
