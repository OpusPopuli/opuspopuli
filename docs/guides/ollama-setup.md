# Ollama Setup Guide

Ollama is the local LLM inference engine for Opus Populi. It runs open-source models for structural analysis and content evaluation. The default model family is Qwen 3.5 (Alibaba Cloud, Apache 2.0).

## Environment Matrix

| Environment | Ollama Mode | URL from Backend | GPU | Config File |
|-------------|------------|-----------------|-----|-------------|
| **Development** | Native macOS/Linux | `http://localhost:11434` | Yes (Metal/CUDA) | `docker-compose.yml` |
| **UAT** | Native macOS/Linux | `http://host.docker.internal:11434` | Yes (Metal/CUDA) | `docker-compose-uat.yml` |
| **Production** | Native macOS | `http://host.docker.internal:11434` | Yes (Metal) | `docker-compose-prod.yml` |
| **Integration tests** | Mocked or native | N/A | N/A | `docker-compose-e2e.yml` |
| **Unit tests** | Mocked | N/A | N/A | N/A |

**Why always native?** Docker cannot access Apple Metal GPU. Running Ollama natively gives full GPU acceleration (Metal on macOS, CUDA on Linux), which is 5-10x faster than CPU-only Docker inference. All environments now use native Ollama — there is no Docker Ollama container.

---

## Quick Setup

The setup script installs Ollama, starts it, and pulls the right models for your environment:

```bash
# Development — MacBook Pro M4 Pro (48GB)
# Pulls: qwen3.5:9b (9B)
./scripts/setup-ollama.sh --dev

# Production — Mac Studio M4 Max (128GB)
# Pulls: qwen3.5:35b (35B)
./scripts/setup-ollama.sh --prod
```

### Manual Installation

If you prefer to set up manually:

#### 1. Install Ollama

```bash
brew install ollama    # macOS
# or: curl -fsSL https://ollama.com/install.sh | sh   # Linux
```

Ollama installs as a macOS app and registers a launchd agent that auto-starts on login.

#### 2. Start Ollama

```bash
open -a Ollama              # macOS (recommended)
# or: brew services start ollama
# or: ollama serve
```

#### 3. Verify

```bash
curl http://localhost:11434/
# Expected: "Ollama is running"
```

---

## Model Management

### Pull Models

```bash
# Dev (48GB+ unified memory)
ollama pull qwen3.5:9b     # 9B — fast iteration, 256K context

# Production (128GB+ unified memory)
ollama pull qwen3.5:35b    # 35B — full quality, 256K context
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
ollama pull qwen3.5:9b
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

## Development Setup

Ollama runs natively on the host in all environments (including development) for GPU acceleration:

```bash
# Install Ollama
brew install ollama    # macOS
# or download from https://ollama.com/download

# Start Ollama
open -a Ollama         # macOS (recommended)
# or: ollama serve

# Pull the default model
ollama pull qwen3.5:9b

# Verify
ollama list

# Then start the dev stack (Ollama is NOT included — it runs on the host)
docker compose up -d
```

Backend services running locally connect to `http://localhost:11434`. Dockerized services connect via `http://host.docker.internal:11434`.

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
1. Use a smaller model (`qwen3.5:9b` instead of `qwen3.5:35b`)
2. Use a quantized variant: `ollama pull qwen3.5:9b-q4_0`
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