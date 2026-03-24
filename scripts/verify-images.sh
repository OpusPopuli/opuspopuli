#!/bin/bash
# =============================================================================
# Container Image Verification Script
# =============================================================================
#
# Verifies Opus Populi container image signatures and SBOM attestations
# using Sigstore keyless cosign. No signing keys required — verification
# uses the GitHub Actions OIDC certificate identity.
#
# Prerequisites:
#   brew install cosign   (macOS)
#   go install github.com/sigstore/cosign/v2/cmd/cosign@latest   (Go)
#
# Usage:
#   ./scripts/verify-images.sh                     # verify all services
#   ./scripts/verify-images.sh --service users     # verify one service
#   ./scripts/verify-images.sh --sbom users        # show SBOM for a service
#   ./scripts/verify-images.sh --tag sha-abc1234   # verify a specific tag
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REGISTRY="ghcr.io/opuspopuli"
SERVICES=(api users documents knowledge region)
CERT_IDENTITY_REGEXP="https://github\\.com/OpusPopuli/opuspopuli/\\.github/workflows/release\\.yml@.*"
CERT_OIDC_ISSUER="https://token.actions.githubusercontent.com"

TAG="latest"
TARGET_SERVICE=""
SHOW_SBOM=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --service)
      TARGET_SERVICE="$2"
      shift 2
      ;;
    --sbom)
      SHOW_SBOM="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--service <name>] [--sbom <name>] [--tag <tag>]"
      echo ""
      echo "Options:"
      echo "  --service <name>   Verify a single service (api|users|documents|knowledge|region)"
      echo "  --sbom <name>      Show SBOM for a service"
      echo "  --tag <tag>        Image tag to verify (default: latest)"
      echo ""
      echo "Examples:"
      echo "  $0                          # verify all services"
      echo "  $0 --service users          # verify one service"
      echo "  $0 --sbom api               # show SBOM for api service"
      echo "  $0 --tag sha-abc1234        # verify a specific tag"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help for usage)"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if ! command -v cosign &> /dev/null; then
  echo -e "${RED}ERROR: cosign is not installed.${NC}"
  echo ""
  echo "Install with:"
  echo "  brew install cosign          (macOS)"
  echo "  go install github.com/sigstore/cosign/v2/cmd/cosign@latest"
  echo ""
  echo "See: https://docs.sigstore.dev/cosign/system_config/installation/"
  exit 1
fi

# ---------------------------------------------------------------------------
# SBOM display mode
# ---------------------------------------------------------------------------
if [[ -n "$SHOW_SBOM" ]]; then
  IMAGE="${REGISTRY}/${SHOW_SBOM}:${TAG}"
  echo "Fetching SBOM attestation for ${IMAGE} ..."
  echo ""
  cosign verify-attestation \
    --type spdxjson \
    --certificate-identity-regexp "$CERT_IDENTITY_REGEXP" \
    --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
    "$IMAGE" 2>/dev/null \
    | jq -r '.payload' | base64 -d | jq '.predicate'
  exit 0
fi

# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------
if [[ -n "$TARGET_SERVICE" ]]; then
  SERVICES=("$TARGET_SERVICE")
fi

echo "============================================"
echo "  Opus Populi — Image Verification"
echo "============================================"
echo ""
echo "Registry:  ${REGISTRY}"
echo "Tag:       ${TAG}"
echo "Services:  ${SERVICES[*]}"
echo ""

PASS=0
FAIL=0

for service in "${SERVICES[@]}"; do
  IMAGE="${REGISTRY}/${service}:${TAG}"
  printf "  %-12s " "${service}:"

  # Verify signature
  if cosign verify \
    --certificate-identity-regexp "$CERT_IDENTITY_REGEXP" \
    --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
    "$IMAGE" > /dev/null 2>&1; then
    echo -e "${GREEN}SIGNED ✓${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}UNSIGNED ✗${NC}"
    FAIL=$((FAIL + 1))
  fi

  # Verify SBOM attestation
  printf "  %-12s " ""
  if cosign verify-attestation \
    --type spdxjson \
    --certificate-identity-regexp "$CERT_IDENTITY_REGEXP" \
    --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
    "$IMAGE" > /dev/null 2>&1; then
    echo -e "${GREEN}SBOM ATTESTED ✓${NC}"
  else
    echo -e "${YELLOW}SBOM MISSING ⚠${NC}"
  fi
done

echo ""
echo "--------------------------------------------"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "--------------------------------------------"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}WARNING: ${FAIL} image(s) failed signature verification.${NC}"
  echo "Do NOT deploy unsigned images in production."
  exit 1
fi

echo ""
echo -e "${GREEN}All images verified successfully.${NC}"
