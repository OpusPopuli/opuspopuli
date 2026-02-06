# LLM Configuration Guide

This guide covers configuring and switching between different LLM models using Ollama.

## Overview

Opus Populi uses Ollama as the LLM inference engine, which supports running any open-source model locally. The default model is Falcon 7B, but you can easily switch to other models like Llama, Mistral, or Qwen.

## Default Configuration

```bash
# apps/backend/.env
LLM_URL=http://localhost:11434
LLM_MODEL=falcon
```

## Available Models

### Falcon 7B (Default)

**Model**: `falcon` or `falcon:7b`

**Details**:
- Size: 7 billion parameters
- Context: 2048 tokens
- License: Apache 2.0
- Developer: TII (Technology Innovation Institute)

**Best for**: General-purpose tasks, balanced speed and quality

**Pull command**:
```bash
docker exec opuspopuli-ollama ollama pull falcon
```

---

### Llama 3.2 (Fast)

**Model**: `llama3.2` or `llama3.2:3b`

**Details**:
- Size: 3 billion parameters
- Context: 8192 tokens
- License: Llama 3 Community License
- Developer: Meta

**Best for**: Quick responses, high throughput

**Pull command**:
```bash
docker exec opuspopuli-ollama ollama pull llama3.2
```

**Configuration**:
```bash
LLM_MODEL=llama3.2
```

---

### Mistral (High Quality)

**Model**: `mistral` or `mistral:7b`

**Details**:
- Size: 7 billion parameters
- Context: 8192 tokens
- License: Apache 2.0
- Developer: Mistral AI

**Best for**: High-quality answers, complex queries

**Pull command**:
```bash
docker exec opuspopuli-ollama ollama pull mistral
```

**Configuration**:
```bash
LLM_MODEL=mistral
```

---

### Llama 3.1 (Long Context)

**Model**: `llama3.1` or `llama3.1:8b`

**Details**:
- Size: 8 billion parameters
- Context: 128K tokens (!!)
- License: Llama 3 Community License
- Developer: Meta

**Best for**: Long documents, complex reasoning

**Pull command**:
```bash
docker exec opuspopuli-ollama ollama pull llama3.1
```

**Configuration**:
```bash
LLM_MODEL=llama3.1
```

---

### Qwen 2.5 (Multilingual)

**Model**: `qwen2.5` or `qwen2.5:7b`

**Details**:
- Size: 7 billion parameters
- Context: 32K tokens
- License: Apache 2.0
- Developer: Alibaba Cloud

**Best for**: Multilingual support, code generation

**Pull command**:
```bash
docker exec opuspopuli-ollama ollama pull qwen2.5
```

**Configuration**:
```bash
LLM_MODEL=qwen2.5
```

---

## Switching Models

### Step 1: Pull the New Model

```bash
# Example: Switch to Mistral
docker exec opuspopuli-ollama ollama pull mistral

# Verify it's downloaded
docker exec opuspopuli-ollama ollama list
```

Expected output:
```
NAME                ID              SIZE      MODIFIED
mistral:latest      abc123def456    4.1 GB    2 minutes ago
falcon:latest       def456abc123    4.0 GB    1 day ago
```

### Step 2: Update Configuration

Edit `apps/backend/.env`:
```bash
# Change this line
LLM_MODEL=falcon

# To this
LLM_MODEL=mistral
```

### Step 3: Restart Backend

```bash
cd apps/backend
npm run start:dev
```

You should see in the logs:
```
[KnowledgeService] KnowledgeService initialized with vector DB: pgvector, LLM: Ollama/mistral
```

### Step 4: Test

Ask a question and verify the new model is being used. Check the logs for:
```
[KnowledgeService] Generating answer with Ollama/mistral
```

---

## Model Comparison

| Model | Size | Context | Speed (GPU) | Quality | Best For |
|-------|------|---------|------------|---------|----------|
| **Falcon 7B** | 7B | 2K | Medium | Good | Balanced (default) |
| **Llama 3.2** | 3B | 8K | Fast | Good | Quick responses |
| **Mistral** | 7B | 8K | Medium | Excellent | High quality |
| **Llama 3.1** | 8B | 128K | Slow | Excellent | Long context |
| **Qwen 2.5** | 7B | 32K | Medium | Excellent | Multilingual, code |

---

## Generation Parameters

Control how the LLM generates text by adjusting parameters in the code:

```typescript
// apps/backend/src/apps/knowledge/src/domains/knowledge.service.ts

const result = await this.llm.generate(prompt, {
  maxTokens: 500,      // Max length of response
  temperature: 0.7,    // Creativity (0.0 = deterministic, 1.0 = creative)
  topP: 0.95,         // Nucleus sampling
  topK: 40,           // Top-K sampling
});
```

### Temperature

Controls randomness/creativity:

| Value | Behavior | Use Case |
|-------|----------|----------|
| 0.0 - 0.3 | Deterministic, factual | Factual Q&A, data extraction |
| 0.4 - 0.7 | **Balanced (default)** | General RAG, conversations |
| 0.8 - 1.0 | Creative, diverse | Brainstorming, storytelling |

**Example**:
```typescript
// More factual (for RAG)
temperature: 0.3

// More creative (for writing)
temperature: 0.9
```

### Max Tokens

Maximum number of tokens to generate:

```typescript
maxTokens: 100   // Short answers
maxTokens: 500   // Default (medium answers)
maxTokens: 2000  // Long, detailed answers
```

**Note**: Each model has a context limit. Ensure `prompt + maxTokens < context_limit`.

### Top-P (Nucleus Sampling)

Only consider tokens with cumulative probability > topP:

```typescript
topP: 0.9   // More diverse
topP: 0.95  // Default (balanced)
topP: 1.0   // Consider all tokens
```

### Top-K

Only consider the top K most likely tokens:

```typescript
topK: 10   // Very focused
topK: 40   // Default (balanced)
topK: 100  // More diverse
```

---

## Testing Models

### Command Line Test

```bash
# Test Falcon directly
docker exec opuspopuli-ollama ollama run falcon "What is RAG?"

# Test Mistral
docker exec opuspopuli-ollama ollama run mistral "Explain semantic search"

# Test with parameters
docker exec opuspopuli-ollama ollama run falcon \
  --temperature 0.3 \
  --num-predict 100 \
  "What is RAG?"
```

### GraphQL Test

```graphql
mutation TestRAG {
  indexDocument(
    userId: "test-user"
    documentId: "test-doc"
    text: "The quick brown fox jumps over the lazy dog. This is a test document for RAG."
  ) {
    success
  }
}

query TestQuery {
  answerQuery(
    userId: "test-user"
    query: "What animal jumps?"
  )
}
```

Compare responses from different models to find the best fit.

---

## Performance Optimization

### GPU Acceleration

Ollama automatically uses GPU if available. To enable GPU in Docker:

1. Install [nvidia-docker](https://github.com/NVIDIA/nvidia-docker)

2. Update `docker-compose.yml`:
```yaml
ollama:
  image: ollama/ollama:latest
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

3. Restart:
```bash
docker-compose down
docker-compose up -d ollama
```

4. Verify GPU is detected:
```bash
docker exec opuspopuli-ollama nvidia-smi
```

### CPU Optimization

If running on CPU only:

1. **Use smaller models**: Llama 3.2 (3B) instead of Falcon (7B)
2. **Reduce maxTokens**: Generate shorter responses
3. **Increase resources**: Give Docker more CPU cores

```bash
# Docker Desktop: Settings → Resources → CPUs (increase to 4-8)
```

### Model Quantization

Ollama models are already quantized (GGUF format). For even smaller sizes:

```bash
# Pull quantized version
docker exec opuspopuli-ollama ollama pull falcon:7b-q4_0  # 4-bit quantization
docker exec opuspopuli-ollama ollama pull falcon:7b-q8_0  # 8-bit quantization
```

**Trade-offs**:
- q4_0: Fastest, lowest quality
- q8_0: Slower, better quality
- Default: Balanced

---

## Troubleshooting

### Model Download Fails

**Error**: `Error pulling model: connection timeout`

**Solutions**:
1. Check internet connection
2. Try again (large files can timeout)
3. Download outside Docker:
```bash
# Install Ollama locally
brew install ollama  # macOS
# or download from https://ollama.ai

# Pull model
ollama pull falcon

# Import to Docker
docker cp ~/.ollama opuspopuli-ollama:/root/.ollama
```

### Out of Memory

**Error**: `Error: failed to allocate memory`

**Solutions**:
1. Use smaller model (Llama 3.2 3B)
2. Increase Docker memory: Settings → Resources → Memory
3. Use quantized model (q4_0 or q8_0)
4. Close other applications

### Slow Generation

**Symptoms**: >10 seconds per response

**Solutions**:
1. **Enable GPU** (see above)
2. **Use smaller model**: Llama 3.2 instead of Llama 3.1
3. **Reduce maxTokens**: Generate shorter responses
4. **Reduce context**: Retrieve fewer chunks (change `nResults: 3` to `nResults: 2`)

### Wrong Model Being Used

**Symptoms**: Logs show old model name

**Solutions**:
1. Verify `.env` file is updated
2. Restart backend completely (not just hot-reload)
3. Check logs for model initialization:
```
[KnowledgeService] KnowledgeService initialized with ... LLM: Ollama/falcon
```

---

## Custom Fine-Tuned Models

You can use custom fine-tuned models with Ollama:

### Step 1: Create Modelfile

```dockerfile
# Modelfile
FROM falcon:7b

# Set custom parameters
PARAMETER temperature 0.5
PARAMETER top_p 0.9

# Set custom system prompt
SYSTEM You are an expert assistant specializing in technical documentation.
```

### Step 2: Build Custom Model

```bash
docker exec -i opuspopuli-ollama ollama create my-custom-model < Modelfile
```

### Step 3: Configure

```bash
LLM_MODEL=my-custom-model
```

---

## Best Practices

1. **Start with Falcon 7B**: Good balance of quality and speed
2. **Test multiple models**: Each has strengths/weaknesses
3. **Monitor performance**: Track latency and quality
4. **Use temperature wisely**: Lower for factual, higher for creative
5. **Keep models updated**: Run `ollama pull <model>` periodically
6. **Match context to task**: Use smaller models for simple tasks

---

## Related Documentation

- [AI/ML Pipeline](../architecture/ai-ml-pipeline.md) - Architecture details
- [RAG Implementation](rag-implementation.md) - Using the RAG system
- [Docker Setup](docker-setup.md) - Infrastructure configuration
- [Ollama Library](https://ollama.ai/library) - Browse all available models
