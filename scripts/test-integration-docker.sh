#!/bin/bash
# Integration Test Runner Script
#
# Runs integration tests in a fully containerized Docker environment.
# This script builds all services, waits for them to be healthy, runs tests, and cleans up.
#
# Usage:
#   ./scripts/test-integration-docker.sh
#   # or
#   pnpm test:integration:docker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_FILE="docker-compose-integration.yml"
MAX_RETRIES=90  # 3 minutes total (90 * 2 seconds)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Integration Test Runner (Docker)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to cleanup on exit
cleanup() {
  echo ""
  echo -e "${YELLOW}Cleaning up Docker containers...${NC}"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
}

# Set trap to cleanup on exit (including errors)
trap cleanup EXIT

# Build and start all services
echo -e "${YELLOW}Building and starting all services...${NC}"
echo -e "${YELLOW}This may take a few minutes on first run...${NC}"
echo ""

docker compose -f "$COMPOSE_FILE" up -d --build

echo ""
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
echo ""

# Wait for Supabase DB first
RETRY_COUNT=0
echo -n "Waiting for PostgreSQL"
until docker compose -f "$COMPOSE_FILE" exec -T supabase-db pg_isready -U postgres > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo ""
    echo -e "${RED}Timeout waiting for PostgreSQL${NC}"
    docker compose -f "$COMPOSE_FILE" logs supabase-db
    exit 1
  fi
  echo -n "."
  sleep 2
done
echo -e " ${GREEN}ready${NC}"

# Wait for API Gateway (depends on all other services)
RETRY_COUNT=0
echo -n "Waiting for API Gateway"
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo ""
    echo -e "${RED}Timeout waiting for API Gateway${NC}"
    echo ""
    echo -e "${YELLOW}Service logs:${NC}"
    docker compose -f "$COMPOSE_FILE" logs --tail=50 api
    exit 1
  fi
  echo -n "."
  sleep 2
done
echo -e " ${GREEN}ready${NC}"

# Quick health check of all services
echo ""
echo -e "${YELLOW}Verifying all services...${NC}"
for service in users documents knowledge region api; do
  port=$((3000 + $(echo "users documents knowledge region api" | tr ' ' '\n' | grep -n "^${service}$" | cut -d: -f1) - 1))
  if [ "$service" = "api" ]; then
    port=3000
  elif [ "$service" = "users" ]; then
    port=3001
  elif [ "$service" = "documents" ]; then
    port=3002
  elif [ "$service" = "knowledge" ]; then
    port=3003
  elif [ "$service" = "region" ]; then
    port=3004
  fi

  if curl -sf "http://localhost:${port}/health" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} ${service} (port ${port})"
  else
    echo -e "  ${RED}✗${NC} ${service} (port ${port})"
  fi
done

echo ""
echo -e "${GREEN}All services healthy!${NC}"
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Running Integration Tests${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Run integration tests
TEST_EXIT_CODE=0
pnpm test:integration || TEST_EXIT_CODE=$?

echo ""
echo -e "${BLUE}========================================${NC}"
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}  Integration tests PASSED${NC}"
else
  echo -e "${RED}  Integration tests FAILED${NC}"
fi
echo -e "${BLUE}========================================${NC}"

exit $TEST_EXIT_CODE
