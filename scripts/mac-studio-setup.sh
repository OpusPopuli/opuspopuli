#!/bin/bash
# =============================================================================
# Mac Studio M4 Max — Production Setup Script
# =============================================================================
#
# Sets up the Mac Studio as the Opus Populi production server:
#   1. Ollama (native macOS for Metal GPU acceleration)
#   2. Docker Desktop
#   3. cloudflared (Cloudflare tunnel client)
#   4. macOS auto-restart on power failure
#
# Prerequisites:
#   - macOS with Apple Silicon (M4 Max)
#   - Homebrew installed (https://brew.sh)
#   - Cloudflare account with tunnel created (via Terraform)
#
# Usage:
#   chmod +x scripts/mac-studio-setup.sh
#   ./scripts/mac-studio-setup.sh
#
# =============================================================================

set -euo pipefail

echo "============================================"
echo "  Opus Populi — Mac Studio Production Setup"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Ollama (Native macOS — NOT Docker)
# ---------------------------------------------------------------------------
echo "--- Installing Ollama ---"
if command -v ollama &> /dev/null; then
    echo "Ollama already installed: $(ollama --version)"
else
    brew install ollama
    echo "Ollama installed successfully"
fi

echo ""
echo "Pulling LLM models (this may take a while)..."
ollama pull mistral           # 7B — structural analysis, fast
ollama pull llama3.1:70b      # 70B — fits in 128GB unified memory

echo ""
echo "Ollama models ready. Ollama runs as a launchd agent on port 11434."
echo "Docker containers access it via: http://host.docker.internal:11434"
echo ""

# ---------------------------------------------------------------------------
# 2. Docker Desktop
# ---------------------------------------------------------------------------
echo "--- Checking Docker ---"
if command -v docker &> /dev/null; then
    echo "Docker already installed: $(docker --version)"
else
    echo "Docker Desktop not found."
    echo "Download and install from: https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "After installing Docker Desktop:"
    echo "  1. Open Docker Desktop → Settings → General"
    echo "  2. Enable 'Start Docker Desktop when you sign in to your computer'"
    echo "  3. Allocate at least 16GB memory (Settings → Resources)"
    echo ""
fi

# ---------------------------------------------------------------------------
# 3. cloudflared
# ---------------------------------------------------------------------------
echo "--- Installing cloudflared ---"
if command -v cloudflared &> /dev/null; then
    echo "cloudflared already installed: $(cloudflared --version)"
else
    brew install cloudflared
    echo "cloudflared installed successfully"
fi

echo ""
echo "cloudflared runs as a Docker container in docker-compose-prod.yml."
echo "The TUNNEL_TOKEN is set via .env.production."
echo ""

# ---------------------------------------------------------------------------
# 4. macOS Auto-Restart
# ---------------------------------------------------------------------------
echo "--- Configuring auto-restart ---"
echo ""
echo "MANUAL STEP REQUIRED:"
echo "  System Settings → General → Startup & Shutdown"
echo "  → Enable 'Start up automatically after a power failure'"
echo ""
echo "This ensures the Mac Studio restarts after a power outage."
echo "Combined with Docker's 'restart: unless-stopped', all services"
echo "will auto-recover."
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Copy environment template:"
echo "     cp .env.production.example .env.production"
echo ""
echo "  2. Fill in .env.production with your values"
echo "     (Supabase keys, JWT secrets, tunnel token)"
echo ""
echo "  3. Get the tunnel token from Terraform:"
echo "     cd infra/cloudflare"
echo "     terraform workspace select prod"
echo "     terraform output -raw tunnel_token"
echo ""
echo "  4. Start the production stack:"
echo "     docker compose -f docker-compose-prod.yml --env-file .env.production up -d --build"
echo ""
echo "  5. Verify:"
echo "     curl https://api.opuspopuli.org/health"
echo ""
echo "Recommended hardware:"
echo "  - UPS: APC Back-UPS Pro 1500VA (~\$200)"
echo "    Provides 15+ min runtime for Mac Studio + router/modem"
echo ""
