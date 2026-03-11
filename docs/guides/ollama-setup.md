# Ollama Setup Guide

Ollama is the local LLM inference engine for Opus Populi. It runs open-source models (Mistral, Llama, etc.) for structural analysis and content evaluation.

## Environment Matrix

| Environment | Ollama Mode | URL from Backend | GPU | Config File |
|-------------|------------|-----------------|-----|-------------|
| **Development** | Docker container | `http://localhost:11434` | No (CPU) | `docker-compose.yml` |
| **Production** | Native macOS | `http://host.docker.internal:11434` | Yes (Metal) | `docker-compose-prod.yml` |
| **Integration tests** | Docker container | `http://ollama:11434` | No (CPU) | `docker-compose-e2e.yml` |
| **Unit tests** | Mocked | N/A | N/A | N/A |

**Why native for production?** Docker cannot access Apple Metal GPU. Running Ollama natively on macOS gives full GPU acceleration via Metal, which is 5-10x faster than CPU-only Docker inference.

---

## Installation (Production -- Native macOS)

### 1. Install Ollama

```bash
brew install ollama
```

Ollama installs as a macOS app and registers a launchd agent that auto-starts on login.

### 2. Verify Installation

```bash
ollama --version
```

### 3. Ensure Ollama is Running

Ollama starts automatically when you open the app or log in. Verify:

```bash
curl http://localhost:11434/
# Expected: "Ollama is running"
```

If not running:

```bash
# Option 1: Open the app (recommended on macOS)
open -a Ollama

# Option 2: Start via brew services
brew services start ollama

# Option 3: Start manually
ollama serve
```

---

## Model Management

### Pull Models

```bash
# Default model for structural analysis (recommended)
ollama pull mistral

# Large model for complex reasoning (requires 64+ GB unified memory)
ollama pull llama3.1:70b

# Fast model for quick responses
ollama pull llama3.2
```

### List Installed Models

```bash
ollama list
```

### Remove a Model

```bash
ollama rm <model-name>
```

### Update Models

```bash
# Re-pull to get the latest version
ollama pull mistral
```

---

## Starting Production

Use the production startup script, which verifies Ollama health before launching Docker:

```bash
./scripts/start-prod.sh
```

The script:
1. Checks Ollama is installed
2. Starts Ollama if not running
3. Verifies the required model is pulled (reads `LLM_MODEL` from `.env.production`)
4. Runs an API health check
5. Starts `docker-compose-prod.yml`
6. Verifies containers can reach Ollama via `host.docker.internal`

### Script Options

```bash
# Use a different env file
./scripts/start-prod.sh --env-file .env.staging

# Skip model pull check (faster startup)
./scripts/start-prod.sh --skip-pull

# Force rebuild containers
./scripts/start-prod.sh --build
```

---

## Health Checks

### Host-side (verify Ollama is running)

```bash
# Basic check
curl http://localhost:11434/

# List available models via API
curl http://localhost:11434/api/tags
```

### Container-side (verify Docker can reach Ollama)

```bash
docker exec opuspopuli-prod-knowledge \
  node -e "require('http').get('http://host.docker.internal:11434/api/tags', r => {
    r.on('data', d => process.stdout.write(d));
    r.on('end', () => console.log());
  })"
```

---

## Development Setup (Docker)

For development, Ollama runs inside Docker (no GPU needed):

```bash
# Start the dev stack (includes Ollama container)
docker compose up -d

# Pull a model into the Docker container
docker exec opuspopuli-ollama ollama pull mistral

# Verify
docker exec opuspopuli-ollama ollama list
```

See [Docker Setup](docker-setup.md) for the full development environment.

---

## Troubleshooting

### Ollama Not Starting

**Symptoms:** `curl http://localhost:11434/` fails

**Solutions:**
1. Check if the launchd agent is registered: `launchctl list | grep ollama`
2. Try starting manually: `ollama serve` (check for error output)
3. Check if port 11434 is in use: `lsof -i :11434`
4. Restart: `brew services restart ollama`

### `host.docker.internal` Not Resolving

**Symptoms:** Containers can't reach Ollama

**Solutions:**
- **macOS:** Ensure Docker Desktop is running (not just Docker Engine). Docker Desktop automatically configures `host.docker.internal`.
- **Linux:** Add `extra_hosts: ["host.docker.internal:host-gateway"]` to each service in `docker-compose-prod.yml`.

### Model Not Found

**Symptoms:** `Error: model 'xyz' not found`

**Solutions:**
1. Pull the model: `ollama pull <model>`
2. Check `LLM_MODEL` in `.env.production` matches an installed model
3. Verify with `ollama list`

### Out of Memory

**Symptoms:** Ollama crashes or system becomes unresponsive

**Solutions:**
1. Use a smaller model (`mistral` 7B instead of `llama3.1:70b`)
2. Use a quantized variant: `ollama pull mistral:7b-q4_0`
3. Close other memory-intensive applications
4. Check available memory: `sysctl hw.memsize` (macOS)

### Slow Inference

**Symptoms:** Responses take >10 seconds

**Solutions:**
1. Verify GPU is being used: check Activity Monitor for "Ollama" GPU usage
2. Use a smaller model for latency-sensitive tasks
3. Reduce `maxTokens` in generation parameters
4. Ensure no other processes are competing for GPU

---

## Related Documentation

- [LLM Configuration](llm-configuration.md) -- Model selection, parameters, and switching
- [Deployment Guide](deployment.md) -- Full production deployment
- [Docker Setup](docker-setup.md) -- Development environment