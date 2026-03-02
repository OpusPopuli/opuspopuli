import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeResolver } from './knowledge.resolver';
import { EmbeddingsModule } from '@opuspopuli/embeddings-provider';
import { VectorDBModule } from '@opuspopuli/vectordb-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';

/**
 * Knowledge Module
 *
 * Provides semantic search and RAG capabilities.
 * Uses embeddings (Xenova/Ollama), vector database (pgvector on PostgreSQL),
 * and LLM (Ollama) for answer generation.
 *
 * All components are self-hosted OSS for full transparency and privacy.
 */
@Module({
  imports: [
    EmbeddingsModule,
    VectorDBModule,
    LLMModule,
    PromptClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
          promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
          hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
        },
      }),
    }),
  ],
  providers: [KnowledgeService, KnowledgeResolver],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
