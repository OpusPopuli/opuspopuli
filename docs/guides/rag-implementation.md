# RAG Implementation Guide

This guide explains how to use the RAG (Retrieval-Augmented Generation) system in Opus Populi.

## What is RAG?

RAG combines semantic search with LLM generation to answer questions based on your documents:

1. **Retrieval**: Find relevant document chunks using vector similarity search
2. **Augmentation**: Add retrieved context to the prompt
3. **Generation**: Use LLM to generate an answer based on context

**Benefits**:
- Answers are grounded in your data
- No hallucinations (LLM can only use provided context)
- Works with private/proprietary documents
- No fine-tuning required

## Quick Example

```graphql
# 1. Index a document
mutation {
  indexDocument(
    userId: "user-1"
    documentId: "quarterly-report"
    text: "Q4 2024 revenue was $1.2M, up 25% from Q3..."
  ) {
    success
    message
  }
}

# 2. Ask a question
query {
  answerQuery(
    userId: "user-1"
    query: "What was the Q4 revenue?"
  )
}

# Response: "Q4 2024 revenue was $1.2M, which represents a 25% increase from Q3."
```

## Using the GraphQL API

### Index a Document

```graphql
mutation IndexDocument {
  indexDocument(
    userId: "user-123"
    documentId: "doc-456"
    text: """
    Your document content here.
    Can be multiple paragraphs.
    Works with any text content.
    """
  ) {
    success
    message
  }
}
```

**Response**:
```json
{
  "data": {
    "indexDocument": {
      "success": true,
      "message": "Document indexed successfully with 5 chunks"
    }
  }
}
```

### Ask a Question

```graphql
query AskQuestion {
  answerQuery(
    userId: "user-123"
    query: "What are the key findings?"
  )
}
```

**Response**:
```json
{
  "data": {
    "answerQuery": "Based on the document, the key findings are..."
  }
}
```

### Search Without LLM

If you just want relevant chunks without LLM generation:

```graphql
query SearchText {
  searchText(
    userId: "user-123"
    query: "revenue growth"
    count: 5
  )
}
```

**Response**:
```json
{
  "data": {
    "searchText": [
      "Q4 2024 revenue was $1.2M, up 25%...",
      "Revenue growth driven by new customers...",
      "Projected revenue for 2025 is $5M..."
    ]
  }
}
```

## Using the TypeScript API

### Direct Service Usage

```typescript
import { KnowledgeService } from './apps/knowledge/src/domains/knowledge.service';

// Inject KnowledgeService
constructor(private knowledgeService: KnowledgeService) {}

// Index a document
await this.knowledgeService.indexDocument(
  'user-123',
  'doc-456',
  'Your document text here...'
);

// Ask a question
const answer = await this.knowledgeService.answerQuery(
  'user-123',
  'What is the project status?'
);

console.log(answer);
// "The project is currently 75% complete..."
```

### Semantic Search Only

```typescript
const relevantChunks = await this.knowledgeService.searchText(
  'user-123',
  'revenue growth',
  count: 5
);

console.log(relevantChunks);
// ["Q4 revenue was...", "Growth driven by...", ...]
```

## How RAG Works Under the Hood

### 1. Document Indexing

When you index a document, the system:

```typescript
// 1. Chunk the text
const chunks = chunkText(text, {
  chunkSize: 1000,        // Characters per chunk
  chunkOverlap: 200,      // Overlap between chunks
});

// Result:
// ["Lorem ipsum dolor sit amet..." (1000 chars),
//  "...amet consectetur adipiscing..." (1000 chars, 200 overlap),
//  "...adipiscing elit sed do..." (1000 chars, 200 overlap)]

// 2. Generate embeddings for each chunk
const embeddings = await embeddingsProvider.embedDocuments(chunks);

// Result:
// [[0.12, 0.45, ..., 0.78],  // 384-dimensional vector
//  [0.34, 0.21, ..., 0.56],
//  [0.67, 0.89, ..., 0.23]]

// 3. Store in vector database
await vectorDB.createEmbeddings(
  userId,
  documentId,
  embeddings,
  chunks
);
```

### 2. Query Processing

When you ask a question, the system:

```typescript
// 1. Generate embedding for the query
const queryEmbedding = await embeddingsProvider.embedQuery(
  "What is the project status?"
);
// Result: [0.45, 0.67, ..., 0.12]

// 2. Find most similar document chunks
const results = await vectorDB.queryEmbeddings(
  queryEmbedding,
  userId,
  nResults: 3  // Top-3 most similar
);

// Result:
// [
//   { content: "Project is 75% complete..." },
//   { content: "Status updated last week..." },
//   { content: "Remaining tasks include..." }
// ]

// 3. Build prompt with context
const context = results.map(r => r.content).join('\n\n');
const prompt = `
You are a helpful assistant. Answer based on the context below.

Context:
${context}

Question: What is the project status?

Answer:`;

// 4. Generate answer with LLM
const answer = await llm.generate(prompt, {
  maxTokens: 500,
  temperature: 0.7,
});

return answer.text;
```

## Configuration

### Chunking Parameters

```bash
# apps/backend/.env
EMBEDDINGS_CHUNK_SIZE=1000       # Characters per chunk
EMBEDDINGS_CHUNK_OVERLAP=200     # Overlap between chunks
```

**Recommendations**:
- **Short documents** (< 5 pages): `CHUNK_SIZE=500, OVERLAP=100`
- **Medium documents** (5-50 pages): `CHUNK_SIZE=1000, OVERLAP=200` (default)
- **Long documents** (50+ pages): `CHUNK_SIZE=1500, OVERLAP=300`

### Number of Retrieved Chunks

Edit `knowledge.service.ts`:

```typescript
// Retrieve more context for complex questions
const contextChunks = await this.semanticSearch(userId, query, 5);  // Default: 3

// Retrieve less for simple questions
const contextChunks = await this.semanticSearch(userId, query, 2);
```

**Trade-offs**:
- **More chunks**: Better context, slower LLM, higher cost
- **Fewer chunks**: Faster, cheaper, but might miss context

### LLM Parameters

Edit `knowledge.service.ts`:

```typescript
const result = await this.llm.generate(prompt, {
  maxTokens: 1000,    // Longer answers
  temperature: 0.3,   // More factual (lower temperature)
  topP: 0.9,
});
```

## Advanced Usage

### Custom Prompts

Modify the prompt template in `knowledge.service.ts`:

```typescript
private buildRAGPrompt(context: string, query: string): string {
  return `You are an expert technical assistant.
Answer the question based ONLY on the context provided.
If the context doesn't contain enough information, say "I don't have enough information to answer this question."

Context:
${context}

Question: ${query}

Detailed Answer:`;
}
```

### Multi-Document Queries

The system automatically searches across all documents for a user:

```typescript
// Index multiple documents
await knowledgeService.indexDocument('user-1', 'doc-1', 'Document 1 content...');
await knowledgeService.indexDocument('user-1', 'doc-2', 'Document 2 content...');
await knowledgeService.indexDocument('user-1', 'doc-3', 'Document 3 content...');

// Query searches all documents
const answer = await knowledgeService.answerQuery(
  'user-1',
  'Find information across all documents'
);
// Returns answer synthesizing information from all 3 documents
```

### Filtered Search

Search specific documents only (requires code changes):

```typescript
// Add filter to vector DB query
const results = await this.vectorDB.queryEmbeddings(
  queryEmbedding,
  userId,
  nResults: 3,
  filter: { documentId: 'doc-123' }  // Only search this document
);
```

### Streaming Responses

For real-time token-by-token generation:

```typescript
async *answerQueryStream(userId: string, query: string): AsyncGenerator<string> {
  // 1. Get context (same as before)
  const contextChunks = await this.semanticSearch(userId, query, 3);
  const context = contextChunks.join('\n\n');
  const prompt = this.buildRAGPrompt(context, query);

  // 2. Stream tokens as they're generated
  for await (const token of this.llm.generateStream(prompt, { maxTokens: 500 })) {
    yield token;  // Send each token to client immediately
  }
}
```

**GraphQL Subscription** (requires additional setup):
```graphql
subscription StreamAnswer {
  answerQueryStream(
    userId: "user-1"
    query: "What is RAG?"
  )
}
```

## Best Practices

### 1. Document Preparation

**Clean text before indexing**:
```typescript
// Remove extra whitespace
text = text.replace(/\s+/g, ' ').trim();

// Remove special characters if needed
text = text.replace(/[^\w\s.,!?-]/g, '');

// Normalize line breaks
text = text.replace(/\n{3,}/g, '\n\n');
```

### 2. Question Formulation

**Good questions**:
- ✅ "What was the Q4 revenue?"
- ✅ "List the key findings from the report"
- ✅ "Summarize the project status"

**Poor questions**:
- ❌ "Tell me about it" (too vague)
- ❌ "What do you think?" (asks for opinion, not facts)
- ❌ "Is this good or bad?" (subjective)

### 3. Context Quality

**Ensure documents contain answers**:
- Index complete, well-formatted documents
- Include relevant metadata (titles, headings)
- Remove irrelevant content (headers, footers, page numbers)

### 4. Testing

**Test the full pipeline**:
```bash
# 1. Index test document
mutation {
  indexDocument(
    userId: "test"
    documentId: "test-doc"
    text: "Known answer: The sky is blue."
  ) { success }
}

# 2. Ask known-answer question
query {
  answerQuery(
    userId: "test"
    query: "What color is the sky?"
  )
}

# Expected: "The sky is blue."
```

### 5. Monitoring

**Track metrics**:
- Indexing time per document
- Query latency
- Number of "no information found" responses
- User satisfaction with answers

## Troubleshooting

### "No relevant information found"

**Cause**: Vector search returned no similar chunks

**Solutions**:
1. Verify document was indexed: Check vector DB for documentId
2. Try different query phrasing
3. Lower similarity threshold (requires code changes)
4. Index more documents

### Poor Quality Answers

**Cause**: LLM generating incorrect or irrelevant answers

**Solutions**:
1. **Improve prompt**: Make instructions more specific
2. **Lower temperature**: More factual (0.3 instead of 0.7)
3. **Retrieve more context**: Increase `nResults` from 3 to 5
4. **Try different model**: Switch from Falcon to Mistral
5. **Better chunking**: Adjust CHUNK_SIZE to preserve context

### Slow Queries

**Cause**: Vector search or LLM generation is slow

**Solutions**:
1. **Enable GPU**: For Ollama (see [LLM Configuration](llm-configuration.md))
2. **Use smaller model**: Llama 3.2 (3B) instead of Falcon (7B)
3. **Reduce context**: Lower `nResults` from 3 to 2
4. **Shorter answers**: Reduce `maxTokens` from 500 to 250
5. **Cache results**: Cache answers for common questions

### Indexing Fails

**Cause**: Embeddings generation or vector storage fails

**Solutions**:
1. Check embeddings provider is running (Xenova auto-downloads, Ollama needs server)
2. Check PostgreSQL is accessible (localhost:5432)
3. Verify dimensions match (384 for Xenova/all-MiniLM-L6-v2)
4. Check logs for specific errors

## Performance Optimization

### Batch Indexing

Index multiple documents efficiently:

```typescript
const documents = [
  { id: 'doc-1', text: '...' },
  { id: 'doc-2', text: '...' },
  { id: 'doc-3', text: '...' },
];

await Promise.all(
  documents.map(doc =>
    knowledgeService.indexDocument(userId, doc.id, doc.text)
  )
);
```

### Caching

Cache common queries:

```typescript
private queryCache = new Map<string, { answer: string; timestamp: number }>();

async answerQuery(userId: string, query: string): Promise<string> {
  const cacheKey = `${userId}:${query}`;
  const cached = this.queryCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < 3600000) {  // 1 hour
    return cached.answer;
  }

  const answer = await this.performRAG(userId, query);
  this.queryCache.set(cacheKey, { answer, timestamp: Date.now() });

  return answer;
}
```

### Parallel Processing

Process embeddings in parallel (if using Ollama with GPU):

```typescript
// Instead of sequential
for (const chunk of chunks) {
  embeddings.push(await provider.embedQuery(chunk));
}

// Use parallel
const embeddings = await Promise.all(
  chunks.map(chunk => provider.embedQuery(chunk))
);
```

##Related Documentation

- [AI/ML Pipeline](../architecture/ai-ml-pipeline.md) - Architecture details
- [LLM Configuration](llm-configuration.md) - Model setup
- [Getting Started](getting-started.md) - Initial setup
- [System Overview](../architecture/system-overview.md) - Overall architecture
