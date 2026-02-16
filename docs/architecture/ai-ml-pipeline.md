# AI/ML Pipeline Architecture

## Overview

The AI/ML pipeline implements RAG (Retrieval-Augmented Generation) using a 100% open-source, self-hosted stack:

1. **Embeddings** - Convert text to semantic vectors (Xenova/Ollama)
2. **Vector Search** - Find relevant context (pgvector on PostgreSQL)
3. **LLM Generation** - Generate answers (Ollama with Falcon 7B)

All processing happens locally with no data sent to third-party APIs.

## RAG Architecture

```
┌─────────────────────────────────────────────────┐
│                 User Query                      │
│           "What is the project status?"         │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│            1. EMBEDDINGS GENERATION             │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Xenova/Transformers.js (in-process)       │ │
│  │ or Ollama (local server)                  │ │
│  │                                           │ │
│  │ Input:  "What is the project status?"     │ │
│  │ Output: [0.12, 0.45, ..., 0.78] (384d)   │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│            2. VECTOR SIMILARITY SEARCH          │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ pgvector (PostgreSQL)                    │ │
│  │                                           │ │
│  │ Cosine similarity search for top-3        │ │
│  │ most similar document chunks              │ │
│  │                                           │ │
│  │ Results:                                  │ │
│  │   1. "Project is 75% complete..."        │ │
│  │   2. "Status updated last week..."       │ │
│  │   3. "Remaining tasks include..."        │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│            3. PROMPT CONSTRUCTION               │
│                                                 │
│  Context:                                       │
│  - Project is 75% complete...                   │
│  - Status updated last week...                  │
│  - Remaining tasks include...                   │
│                                                 │
│  Question: What is the project status?          │
│                                                 │
│  Prompt:                                        │
│  "You are a helpful assistant. Answer based on  │
│   the context below.                            │
│                                                 │
│   Context: [chunks]                             │
│   Question: [query]                             │
│   Answer:"                                      │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│            4. LLM GENERATION                    │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Ollama (Falcon 7B)                        │ │
│  │                                           │ │
│  │ Parameters:                               │ │
│  │   - max_tokens: 500                       │ │
│  │   - temperature: 0.7                      │ │
│  │   - top_p: 0.95                           │ │
│  │                                           │ │
│  │ Output:                                   │ │
│  │ "The project is currently 75% complete.  │ │
│  │  According to the latest update, the     │ │
│  │  remaining tasks include..."             │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│                 ANSWER TO USER                  │
└─────────────────────────────────────────────────┘
```

## Component Details

### 1. Embeddings Generation

**Purpose**: Convert text into numerical vectors that capture semantic meaning

**Provider: Xenova (Default)**

**Technology**: Transformers.js (ONNX Runtime in Node.js)

**Configuration**:
```bash
EMBEDDINGS_PROVIDER=xenova
EMBEDDINGS_XENOVA_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDINGS_CHUNK_SIZE=1000
EMBEDDINGS_CHUNK_OVERLAP=200
```

**Models Available**:
| Model | Dimensions | Speed | Quality | Use Case |
|-------|-----------|-------|---------|----------|
| Xenova/all-MiniLM-L6-v2 | 384 | Fast | Good | General purpose (default) |
| Xenova/paraphrase-MiniLM-L3-v2 | 768 | Fast | Good | Semantic similarity |
| Xenova/all-mpnet-base-v2 | 768 | Medium | Better | High-quality embeddings |

**How It Works**:
```typescript
// 1. Download model on first use (cached locally)
const pipeline = await import('@xenova/transformers').pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

// 2. Generate embeddings
const embedding = await pipeline(text, {
  pooling: 'mean',
  normalize: true,
});

// 3. Extract array
const vector = Array.from(embedding.data); // [0.12, 0.45, ..., 0.78]
```

**Chunking Strategy**:
```typescript
// Text is split into overlapping chunks for better context
chunkSize: 1000 characters
chunkOverlap: 200 characters

Example:
  "Lorem ipsum dolor sit amet..." (1000 chars)
  "...amet consectetur adipiscing..." (1000 chars, 200 overlap)
  "...adipiscing elit sed do..." (1000 chars, 200 overlap)
```

**File Location**: `apps/backend/src/providers/embeddings/providers/xenova.provider.ts`

---

**Provider: Ollama (Alternative)**

**Technology**: Ollama server with GPU acceleration

**Configuration**:
```bash
EMBEDDINGS_PROVIDER=ollama
EMBEDDINGS_OLLAMA_URL=http://localhost:11434
EMBEDDINGS_OLLAMA_MODEL=nomic-embed-text
```

**Models Available**:
| Model | Dimensions | Speed | Quality |
|-------|-----------|-------|---------|
| nomic-embed-text | 768 | Fast (GPU) | Excellent |
| all-minilm | 384 | Fast (GPU) | Good |

**When to Use**:
- You have GPU available
- Already running Ollama for LLM
- Need higher-quality embeddings
- Want consistent stack (Ollama for both embeddings + LLM)

**File Location**: `apps/backend/src/providers/embeddings/providers/ollama.provider.ts`

---

### 2. Vector Similarity Search

**Purpose**: Find document chunks most similar to the query

**Similarity Metric**: Cosine similarity
```
similarity = (A · B) / (||A|| ||B||)

Where:
  A = query embedding
  B = document embedding
  · = dot product
  ||x|| = L2 norm
```

**Provider: pgvector (Default)**

**Technology**: PostgreSQL extension with HNSW indexing

**Configuration**:
```bash
# pgvector uses same PostgreSQL instance
# Falls back to RELATIONAL_DB_* if not specified
VECTOR_DB_HOST=localhost
VECTOR_DB_PORT=5432
VECTOR_DB_DIMENSIONS=384  # Must match embedding model
```

**Search Process**:
```sql
-- Find top-3 most similar vectors
SELECT id, document_id, content,
       1 - (embedding <=> $1::vector) as similarity
FROM vector_embeddings
WHERE user_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 3;
```

**Index Type**: HNSW (Hierarchical Navigable Small World)
- Approximate nearest neighbor (ANN) search
- Fast queries even with millions of vectors
- Tunable accuracy/speed tradeoff

**File Location**: `packages/vectordb-provider/src/providers/pgvector.provider.ts`

---

### 3. LLM Generation

**Purpose**: Generate natural language answers based on retrieved context

**Provider: Ollama (Only Option)**

**Technology**: Ollama inference server with GGUF models

**Configuration**:
```bash
LLM_URL=http://localhost:11434
LLM_MODEL=mistral  # Default model
```

**Model: Mistral 7B Instruct (Default)**

**Details**:
- **Size**: 7 billion parameters
- **Context**: 8192 tokens
- **License**: Apache 2.0 (fully open source)
- **Developer**: Mistral AI
- **Quality**: Excellent instruction following and JSON output reliability

**Alternative Models** (via Ollama):
| Model | Size | Context | Speed | Quality | Use Case |
|-------|------|---------|-------|---------|----------|
| mistral | 7B | 8192 | Medium | Excellent | Structural analysis, JSON (default) |
| llama3.2 | 3B | 8192 | Fast | Good | Quick responses |
| llama3.1 | 8B | 128K | Slow | Excellent | Long context |
| falcon | 7B | 2048 | Medium | Good | General purpose |

**Generation Process**:
```typescript
// 1. Build RAG prompt
const prompt = `You are a helpful assistant. Answer based on context.

Context:
${contextChunks.join('\n\n')}

Question: ${userQuery}

Answer:`;

// 2. Generate with Ollama
const result = await ollama.generate(prompt, {
  maxTokens: 500,      // Max length of answer
  temperature: 0.7,    // Randomness (0.0 = deterministic, 1.0 = creative)
  topP: 0.95,         // Nucleus sampling
  topK: 40,           // Top-K sampling
});

// 3. Return answer
return result.text;
```

**Generation Parameters**:

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| maxTokens | 1-4096 | 500 | Max answer length |
| temperature | 0.0-2.0 | 0.7 | Randomness (lower = more focused) |
| topP | 0.0-1.0 | 0.95 | Nucleus sampling threshold |
| topK | 1-100 | 40 | Number of top tokens to consider |

**Streaming Support**:
```typescript
// Stream tokens as they're generated
for await (const chunk of ollama.generateStream(prompt, options)) {
  process.stdout.write(chunk);  // Output token-by-token
}
```

**File Location**: `apps/backend/src/providers/llm/providers/ollama.provider.ts`

---

## Document Indexing Pipeline

### Full Flow

```typescript
// apps/backend/src/apps/knowledge/src/domains/knowledge.service.ts

async indexDocument(
  userId: string,
  documentId: string,
  text: string
): Promise<void> {
  // 1. Chunk text
  const result = await this.embeddingsService.getEmbeddingsForText(text);
  // result = {
  //   embeddings: [[0.1, 0.2, ...], [0.3, 0.4, ...]],
  //   texts: ['chunk 1...', 'chunk 2...']
  // }

  // 2. Store vectors in database
  await this.vectorDB.createEmbeddings(
    userId,
    documentId,
    result.embeddings,
    result.texts
  );

  this.logger.log(`Indexed ${result.texts.length} chunks for document ${documentId}`);
}
```

### Performance

**Xenova Embeddings**:
- 100-200ms per chunk (CPU)
- Batch processing: ~50-100 chunks/second

**Ollama Embeddings** (with GPU):
- 10-50ms per chunk (GPU)
- Batch processing: ~200-500 chunks/second

**Vector Storage (pgvector)**:
- ~1-5ms per insert

**Example** (1000-word document):
```
1. Chunking: ~10ms
2. Generate embeddings (5 chunks): 500-1000ms (Xenova) or 50-250ms (Ollama)
3. Store vectors: 5-25ms
Total: ~515-1035ms per document
```

---

## Query Pipeline (RAG)

### Full Flow

```typescript
// apps/backend/src/apps/knowledge/src/domains/knowledge.service.ts

async answerQuery(userId: string, query: string): Promise<string> {
  // 1. Generate query embedding
  const queryEmbedding = await this.embeddingsService.getEmbeddingsForQuery(query);

  // 2. Search for similar chunks (semantic search)
  const contextChunks = await this.vectorDB.queryEmbeddings(
    queryEmbedding,
    userId,
    nResults: 3
  );

  if (contextChunks.length === 0) {
    return 'I could not find any relevant information to answer your question.';
  }

  // 3. Build RAG prompt
  const context = contextChunks.map(c => c.content).join('\n\n');
  const prompt = this.buildRAGPrompt(context, query);

  // 4. Generate answer with LLM
  const result = await this.llm.generate(prompt, {
    maxTokens: 500,
    temperature: 0.7,
    topP: 0.95,
  });

  return result.text;
}
```

### Performance

**Query Embedding**:
- Xenova: ~100-200ms (CPU)
- Ollama: ~10-50ms (GPU)

**Vector Search (pgvector)**:
- ~10-100ms (millions of vectors)

**LLM Generation**:
- Falcon 7B (CPU): ~5-10 seconds
- Falcon 7B (GPU): ~500ms-2s
- Llama3.2 3B (GPU): ~200ms-1s

**Total RAG Latency**:
- With GPU: ~700ms-2.3s
- CPU only: ~5.1-10.3s

---

## Prompt Engineering

### RAG Prompt Template

```typescript
private buildRAGPrompt(context: string, query: string): string {
  return `You are a helpful assistant. Answer the question based on the context provided below.

Context:
${context}

Question: ${query}

Answer:`;
}
```

### Best Practices

1. **Clear Instructions**: Tell the LLM what to do
2. **Context First**: Provide relevant information before the question
3. **Specific Questions**: Ask focused questions for better answers
4. **Temperature Tuning**:
   - 0.0-0.3: Factual, deterministic answers
   - 0.4-0.7: Balanced creativity and accuracy (default)
   - 0.8-1.0: Creative, diverse answers

### Advanced Prompting

**Few-Shot Learning**:
```typescript
const prompt = `You are a helpful assistant. Answer based on context.

Example:
Context: The project deadline is March 15th.
Question: When is the deadline?
Answer: The project deadline is March 15th.

Context:
${context}

Question: ${query}

Answer:`;
```

**Chain-of-Thought**:
```typescript
const prompt = `You are a helpful assistant. Answer based on context.
Think step by step before answering.

Context:
${context}

Question: ${query}

Let's think step by step:`;
```

---

## Error Handling

### Embedding Generation Errors
```typescript
try {
  const embeddings = await provider.embedDocuments(texts);
} catch (error) {
  this.logger.error('Embedding generation failed:', error);
  throw new EmbeddingError('Failed to generate embeddings', error);
}
```

### Vector Search Errors
```typescript
try {
  const results = await vectorDB.queryEmbeddings(...);
  if (results.length === 0) {
    return 'No relevant information found';
  }
} catch (error) {
  this.logger.error('Vector search failed:', error);
  throw new VectorDBError('Failed to search vectors', error);
}
```

### LLM Generation Errors
```typescript
try {
  const result = await llm.generate(prompt, options);
} catch (error) {
  this.logger.error('LLM generation failed:', error);
  throw new LLMError('Ollama', 'generate', error);
}
```

---

## Monitoring and Metrics

### Key Metrics to Track

**Embeddings**:
- Generation time per chunk
- Batch throughput
- Model load time
- Dimension validation errors

**Vector Search**:
- Query latency (p50, p95, p99)
- Results returned (distribution)
- Zero-result queries (%)
- Index size growth

**LLM**:
- Generation latency
- Tokens per second
- Context length used
- Finish reasons (stop vs length)

### Logging

```typescript
// Knowledge Service logs
this.logger.log(
  `KnowledgeService initialized with vector DB: ${this.vectorDB.getName()}, ` +
  `LLM: ${this.llm.getName()}/${this.llm.getModelName()}`
);

this.logger.log(`Retrieved ${contextChunks.length} context chunks for RAG`);
this.logger.log(`Generating answer with ${this.llm.getName()}/${this.llm.getModelName()}`);
this.logger.log(`Generated answer: ${result.text.length} chars (${result.tokensUsed || 'unknown'} tokens)`);
```

---

**Related Documentation**:
- [Provider Pattern](provider-pattern.md) - Architecture details
- [Data Layer](data-layer.md) - Vector database details
- [RAG Implementation Guide](../guides/rag-implementation.md) - Practical usage
- [LLM Configuration Guide](../guides/llm-configuration.md) - Model setup
