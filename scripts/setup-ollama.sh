#!/bin/bash

# Setup Ollama with Mistral 7B model
# This script pulls the required model into the Ollama container

echo "🚀 Setting up Ollama with Mistral 7B..."

# Check if Ollama container is running
if ! docker ps | grep -q opuspopuli-ollama; then
    echo "❌ Ollama container is not running"
    echo "Please run: docker-compose up -d ollama"
    exit 1
fi

echo "📥 Pulling Mistral 7B model (this may take a few minutes)..."
docker exec opuspopuli-ollama ollama pull mistral

echo "✅ Mistral 7B model installed!"
echo ""
echo "You can now use Mistral 7B for LLM inference."
echo ""
echo "To verify, run:"
echo "  docker exec opuspopuli-ollama ollama list"
echo ""
echo "To test the model:"
echo "  docker exec opuspopuli-ollama ollama run mistral 'Hello, how are you?'"
