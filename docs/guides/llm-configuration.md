# LLM Configuration Guide

This guide covers configuring and switching between different LLM models using Ollama.

## Overview

Opus Populi uses Ollama as the LLM inference engine, which supports running any open-source model locally. The Qwen 3.5 model family (Alibaba Cloud, Apache 2.0) is used across all environments — Qwen 3.5 9B for development and Qwen 3.5 35B for production.

## Default Configuration

```bash
# apps/backend/.env (development)
LLM_URL=http://localhost:11434
LLM_MODEL=qwen3.5:9b

# .env.production
LLM_URL=http://host.docker.internal:11434
LLM_MODEL=qwen3.5:35b
```

> **All environments:** Ollama always runs natively on the host for GPU acceleration (Metal on macOS, CUDA on Linux). There is no Docker Ollama container. See [Ollama Setup](ollama-setup.md) for details.

## Available Models

### Qwen 3.5 9B (Development Default)

**Model**: `qwen3.5:9b`

**Details**:
- Size: 9 billion parameters
- Context: 256K tokens
- License: Apache 2.0
- Developer: Alibaba Cloud

**Best for**: Fast iteration, development, structural analysis

**Configuration**:
```bash
LLM_MODEL=qwen3.5:9b
```

---

### Qwen 3.5 35B (Production Default)

**Model**: `qwen3.5:35b`

**Details**:
- Size: 35 billion parameters
- Context: 256K tokens
- License: Apache 2.0
- Developer: Alibaba Cloud
- Requires: 128GB+ unified memory (Mac Studio M4 Max)

**Best for**: Complex reasoning, long documents, structural analysis, code generation

**Configuration**:
```bash
LLM_MODEL=qwen3.5:35b
```

---

### Other Compatible Models

Any Ollama model can be used by setting `LLM_MODEL`. Some alternatives:

| Model | Size | Context | License | Best For |
|-------|------|---------|---------|----------|
| `mistral` | 7B | 8K | Apache 2.0 | JSON output, instruction following |
| `gemma2` | 9B / 27B | 8K | Gemma | General purpose |
| `qwen3.5:9b` | 9B | 256K | Apache 2.0 | Dev default, structural analysis |

---

## Switching Models

### Step 1: Pull the New Model

```bash
# Example: Switch to Mistral
ollama pull mistral

# Verify it's downloaded
ollama list
```

### Step 2: Update Configuration

Edit `apps/backend/.env`:
```bash
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
| **Qwen 3.5 9B** | 9B | 256K | Fast | Excellent | Dev default, structural analysis |
| **Qwen 3.5 35B** | 35B | 256K | Medium | Excellent | Prod default, complex reasoning |
| **Mistral** | 7B | 8K | Fast | Excellent | JSON output, instruction following |
| **Gemma 2** | 9B/27B | 8K | Medium | Good | General purpose |

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
# Test Mistral (default)
ollama run mistral "What is RAG?"

# Test Llama 3.1
ollama run llama3.1 "Explain semantic search"

# Test with parameters
ollama run mistral \
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

Ollama runs natively on the host and automatically uses available GPU:

- **macOS (Apple Silicon)**: Metal GPU acceleration is used automatically
- **Linux (NVIDIA)**: Install CUDA drivers; Ollama detects the GPU automatically

Verify GPU is being used by checking Activity Monitor (macOS) or `nvidia-smi` (Linux) while running inference.

### Model Quantization

Ollama models are already quantized (GGUF format). For even smaller sizes:

```bash
# Pull quantized version
ollama pull qwen3.5:9b-q4_0  # 4-bit quantization
ollama pull qwen3.5:9b-q8_0  # 8-bit quantization
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
3. Install/reinstall Ollama:
```bash
brew install ollama  # macOS
# or download from https://ollama.com/download

ollama pull qwen3.5:9b
```

### Out of Memory

**Error**: `Error: failed to allocate memory`

**Solutions**:
1. Use smaller model (Llama 3.2 3B)
2. Use quantized model (q4_0 or q8_0)
3. Close other memory-intensive applications
4. Check available memory: `sysctl hw.memsize` (macOS)

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
[KnowledgeService] KnowledgeService initialized with ... LLM: Ollama/mistral
```

---

## Custom Fine-Tuned Models

You can use custom fine-tuned models with Ollama:

### Step 1: Create Modelfile

```dockerfile
# Modelfile
FROM mistral:7b

# Set custom parameters
PARAMETER temperature 0.5
PARAMETER top_p 0.9

# Set custom system prompt
SYSTEM You are an expert assistant specializing in technical documentation.
```

### Step 2: Build Custom Model

```bash
ollama create my-custom-model -f Modelfile
```

### Step 3: Configure

```bash
LLM_MODEL=my-custom-model
```

---

## Best Practices

1. **Start with Mistral 7B**: Excellent instruction following and JSON output reliability
2. **Test multiple models**: Each has strengths/weaknesses
3. **Monitor performance**: Track latency and quality
4. **Use temperature wisely**: Lower for factual, higher for creative
5. **Keep models updated**: Run `ollama pull <model>` periodically
6. **Match context to task**: Use smaller models for simple tasks

---

## Related Documentation

- [Ollama Setup](ollama-setup.md) - Installation, dev vs prod, health checks
- [AI/ML Pipeline](../architecture/ai-ml-pipeline.md) - Architecture details
- [RAG Implementation](rag-implementation.md) - Using the RAG system
- [Docker Setup](docker-setup.md) - Infrastructure configuration
- [Ollama Library](https://ollama.com/library) - Browse all available models
