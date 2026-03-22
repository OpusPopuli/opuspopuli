# Container Signing & Verification

Opus Populi uses [Sigstore](https://www.sigstore.dev/) keyless signing to ensure container images haven't been tampered with. Every image pushed to GitHub Container Registry (GHCR) is automatically signed and accompanied by an SBOM (Software Bill of Materials).

## How It Works

When code is merged to `main`, the [release workflow](../../.github/workflows/release.yml) runs:

1. **Build** — Docker images are built for each microservice (api, users, documents, knowledge, region)
2. **Push** — Images are pushed to `ghcr.io/opuspopuli/<service>`
3. **Sign** — Each image is signed using cosign with Sigstore keyless signing (GitHub Actions OIDC identity)
4. **SBOM** — An SPDX SBOM is generated with syft and attached as a cosign attestation

No signing keys are stored or managed — the signing identity is derived from the GitHub Actions workflow run via OIDC.

## Prerequisites

Install cosign:

```bash
# macOS
brew install cosign

# Go
go install github.com/sigstore/cosign/v2/cmd/cosign@latest
```

## Verifying Images

### Using the verification script

```bash
# Verify all services
./scripts/verify-images.sh

# Verify a single service
./scripts/verify-images.sh --service users

# Verify a specific image tag
./scripts/verify-images.sh --tag sha-abc1234

# View SBOM for a service
./scripts/verify-images.sh --sbom api
```

### Manual verification with cosign

```bash
# Verify signature
cosign verify \
  --certificate-identity-regexp "https://github\.com/OpusPopuli/opuspopuli/\.github/workflows/release\.yml@.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/opuspopuli/api:latest

# Verify SBOM attestation
cosign verify-attestation \
  --type spdxjson \
  --certificate-identity-regexp "https://github\.com/OpusPopuli/opuspopuli/\.github/workflows/release\.yml@.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/opuspopuli/api:latest
```

## Production Deployment

The production startup script supports optional image verification:

```bash
# Start without verification (default — builds locally)
./scripts/start-prod.sh

# Start with image signature verification
./scripts/start-prod.sh --verify
```

When `--verify` is passed, the script runs `verify-images.sh` before starting Docker Compose. If any image fails verification, the startup is aborted.

## Image Tags

Each release produces two tags per service:

| Tag | Description |
|-----|-------------|
| `latest` | Most recent release |
| `sha-<commit>` | Pinned to a specific commit |

For production, prefer pinning to a specific `sha-*` tag rather than `latest`.

## Trust Model

The verification proves:
- The image was built by the `release.yml` workflow in the `OpusPopuli/opuspopuli` repository
- The build ran on GitHub Actions (verified via OIDC issuer)
- The image contents match the signed digest (tamper detection)
- The SBOM accurately reflects the image contents at build time
