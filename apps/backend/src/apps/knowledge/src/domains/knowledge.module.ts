import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeResolver } from './knowledge.resolver';
import { EmbeddingsModule } from '@opuspopuli/embeddings-provider';
import { VectorDBModule } from '@opuspopuli/vectordb-provider';
import { LLMModule } from '@opuspopuli/llm-provider';

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
  imports: [EmbeddingsModule, VectorDBModule, LLMModule],
  providers: [KnowledgeService, KnowledgeResolver],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
