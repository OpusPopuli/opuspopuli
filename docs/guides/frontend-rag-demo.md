# RAG Demo Guide

This guide explains how to use the RAG (Retrieval-Augmented Generation) demo frontend to test the knowledge pipeline.

## Overview

The RAG Demo provides a simple web interface to:
1. **Index Documents** - Convert text into vector embeddings
2. **Query Knowledge** - Ask questions answered using retrieved context
3. **Search Text** - Perform semantic search without LLM generation

## Prerequisites

Before using the RAG demo, ensure:

1. **Backend Services Running**
   ```bash
   # From project root
   cd apps/backend
   docker-compose up -d    # Start PostgreSQL (with pgvector), Ollama
   pnpm start:dev          # Start all backend services
   ```

2. **Frontend Running**
   ```bash
   cd apps/frontend
   pnpm dev
   ```

3. **Services Available**
   - Frontend: http://localhost:3000
   - API Gateway: http://localhost:3000/graphql
   - PostgreSQL: localhost:5432
   - Ollama: http://localhost:11434

## Using the RAG Demo

### Step 1: Access the Demo

1. Open http://localhost:3000 in your browser
2. Click "RAG Demo" link on the home page
3. You'll see the login screen

### Step 2: Start a Demo Session

1. Enter an email address (e.g., `demo@example.com`)
2. Click "Start Demo Session"
3. A temporary user session is created and stored in your browser

> **Note**: This is demo mode without real authentication. For production, integrate with AWS Cognito.

### Step 3: Index a Document

1. Ensure you're on the "Index Document" tab
2. Optionally enter a Document ID (e.g., `my-doc-1`)
3. Paste your document text into the textarea
4. Click "Index Document"

**Example Document**:
```
The Opus Populi platform is a modern application starter kit built on open-source
technologies. It provides a RAG (Retrieval-Augmented Generation) pipeline using
pgvector for vector storage and Ollama for LLM inference.

Key features include:
- GraphQL Federation for API gateway
- Pluggable provider architecture
- Self-hosted AI/ML capabilities
- 100% open source components
```

**What Happens**:
1. Text is chunked into smaller segments
2. Each chunk is converted to a vector embedding (Xenova)
3. Embeddings are stored in PostgreSQL via pgvector with metadata
4. Success alert confirms indexing

### Step 4: Query Your Knowledge Base

1. Switch to "Query Knowledge Base" tab
2. Enter a question in the input field
3. Choose an action:

**Option A: Ask Question (RAG)**
- Retrieves relevant document chunks
- Builds context for LLM
- Generates natural language answer

**Option B: Search Only**
- Returns relevant text chunks
- No LLM generation
- Useful for debugging retrieval

**Example Questions**:
- "What is Opus Populi?"
- "What technologies does the platform use?"
- "How does the RAG pipeline work?"

### Step 5: Review Results

**RAG Answer**:
```
Based on the indexed documents, Opus Populi is a modern application
starter kit that provides a RAG pipeline using pgvector and Ollama...
```

**Search Results**:
```
Chunk 1: The Opus Populi platform is a modern application starter kit...
Chunk 2: Key features include: GraphQL Federation for API gateway...
```

## Understanding the Pipeline

### Document Indexing Flow

```
User Input → Chunking → Embedding → Vector Storage
     │           │           │            │
     ↓           ↓           ↓            ↓
  "Text..."   [chunk1,    [[0.1,0.2],   pgvector
              chunk2]     [0.3,0.4]]   (PostgreSQL)
```

### RAG Query Flow

```
Question → Embed Query → Vector Search → Build Prompt → LLM → Answer
    │           │              │              │          │       │
    ↓           ↓              ↓              ↓          ↓       ↓
 "What is   [0.2,0.3]     [chunk1,       "Context:   Falcon   "Opus Populi
  this?"                   chunk2]        ..."        7B       is..."
```

## Troubleshooting

### No Results Found

**Symptom**: "I could not find any relevant information"

**Causes**:
1. No documents indexed yet
2. Query doesn't match indexed content
3. PostgreSQL service not running

**Solutions**:
1. Index a document first
2. Try different query phrasing
3. Check `docker-compose ps` for PostgreSQL status

### Slow Response Times

**Symptom**: Query takes >10 seconds

**Causes**:
1. Ollama model loading (first request)
2. Large document chunks
3. GPU not available for Ollama

**Solutions**:
1. Wait for initial model load (~30s first time)
2. Keep document chunks under 1000 characters
3. Ensure Ollama has GPU access

### Indexing Fails

**Symptom**: "Failed to index document" error

**Causes**:
1. Backend services not running
2. PostgreSQL connection issue
3. Embeddings service error

**Solutions**:
1. Verify backend: `curl http://localhost:3000/graphql`
2. Check PostgreSQL: `docker-compose ps supabase-db`
3. Check backend logs for specific errors

### Session Lost

**Symptom**: Returned to login screen unexpectedly

**Causes**:
1. Browser localStorage cleared
2. Page refresh in incognito mode
3. Different browser/device

**Solutions**:
1. Re-enter email to start new session
2. Demo sessions persist only in localStorage

## API Reference

### GraphQL Operations

**Index Document**:
```graphql
mutation IndexDocument($userId: String!, $documentId: String!, $text: String!) {
  indexDocument(userId: $userId, documentId: $documentId, text: $text)
}
```

**Answer Query**:
```graphql
mutation AnswerQuery($userId: String!, $query: String!) {
  answerQuery(userId: $userId, query: $query)
}
```

**Search Text**:
```graphql
query SearchText($userId: String!, $query: String!, $count: Int) {
  searchText(userId: $userId, query: $query, count: $count)
}
```

### Testing with GraphQL Playground

1. Open http://localhost:3000/graphql
2. Use the operations above with variables:
   ```json
   {
     "userId": "test-user-123",
     "query": "What is Opus Populi?"
   }
   ```

## Best Practices

### Document Indexing

1. **Quality Content** - Index well-structured, informative text
2. **Reasonable Size** - Keep documents under 10,000 characters
3. **Unique IDs** - Use meaningful document IDs for tracking
4. **Organized Topics** - Index related content together

### Querying

1. **Natural Questions** - Ask questions as you would to a person
2. **Specific Queries** - More specific questions yield better results
3. **Try Variations** - Rephrase if initial query doesn't work
4. **Use Search First** - Debug retrieval before full RAG

### Performance

1. **Warm Up** - First request loads models, be patient
2. **Batch Indexing** - Index multiple documents sequentially
3. **Monitor Logs** - Check backend logs for issues

## Related Documentation

- [RAG Implementation](rag-implementation.md) - Backend RAG architecture
- [LLM Configuration](llm-configuration.md) - Configuring Ollama models
- [Frontend Architecture](../architecture/frontend-architecture.md) - Frontend design
- [System Overview](../architecture/system-overview.md) - Overall architecture
