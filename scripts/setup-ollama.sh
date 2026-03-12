#!/bin/bash
# =============================================================================
# Ollama Setup Script
# =============================================================================
#
# Installs Ollama natively (not Docker) and pulls models appropriate for the
# target environment. Ollama always runs on bare metal for GPU acceleration.
#
# Usage:
#   ./scripts/setup-ollama.sh          # defaults to --dev
#   ./scripts/setup-ollama.sh --dev    # MacBook Pro M4 Pro (48GB) — qwen3.5:9b
#   ./scripts/setup-ollama.sh --prod   # Mac Studio M4 Max (128GB) — qwen3.5:35b
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
ENV="dev"

while [[ $# -gt 0 ]]; do
  case $1 in
    --dev)
      ENV="dev"
      shift
      ;;
    --prod)
      ENV="prod"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dev|--prod]"
      exit 1
      ;;
  esac
done

echo "============================================"
echo "  Ollama Setup ($ENV)"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Check / install Ollama
# ---------------------------------------------------------------------------
echo "[1/3] Checking Ollama installation..."
if command -v ollama &> /dev/null; then
    echo "      Ollama installed: $(ollama --version 2>/dev/null || echo 'unknown version')"
else
    echo "      Ollama not found. Installing..."
    if [[ "$(uname)" == "Darwin" ]]; then
        brew install ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    echo "      Ollama installed successfully"
fi

# ---------------------------------------------------------------------------
# 2. Ensure Ollama is running
# ---------------------------------------------------------------------------
echo "[2/3] Checking Ollama is running..."
if curl -sf http://localhost:11434/ > /dev/null 2>&1; then
    echo "      Ollama is running on port 11434"
else
    echo "      Ollama is not running. Starting..."
    if [[ "$(uname)" == "Darwin" ]]; then
        open -a "Ollama" 2>/dev/null || brew services start ollama 2>/dev/null || ollama serve &>/dev/null &
    else
        ollama serve &>/dev/null &
    fi

    # Wait up to 15 seconds
    for i in $(seq 1 15); do
        if curl -sf http://localhost:11434/ > /dev/null 2>&1; then
            echo "      Ollama is ready (took ${i}s)"
            break
        fi
        if [[ $i -eq 15 ]]; then
            echo "ERROR: Ollama failed to start within 15 seconds."
            echo "       Try starting manually: open -a Ollama (macOS) or ollama serve (Linux)"
            exit 1
        fi
        sleep 1
    done
fi

# ---------------------------------------------------------------------------
# 3. Pull models for the target environment
# ---------------------------------------------------------------------------
echo "[3/3] Pulling models..."
echo ""

if [[ "$ENV" == "prod" ]]; then
    # Production: Mac Studio M4 Max (128GB unified memory)
    echo "  Environment: Production (128GB+ unified memory)"
    echo ""
    echo "  Pulling qwen3.5:35b (35B) — full quality, 256K context, Apache 2.0..."
    ollama pull qwen3.5:35b
else
    # Development: MacBook Pro M4 Pro (48GB unified memory)
    echo "  Environment: Development (48GB+ unified memory)"
    echo ""
    echo "  Pulling qwen3.5:9b (9B) — fast iteration, 256K context, Apache 2.0..."
    ollama pull qwen3.5:9b
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Ollama Setup Complete ($ENV)"
echo "============================================"
echo ""
echo "Installed models:"
ollama list
echo ""
echo "Docker containers access Ollama via: http://host.docker.internal:11434"
echo "Local services access Ollama via:    http://localhost:11434"
echo ""
echo "See docs/guides/ollama-setup.md for more details."