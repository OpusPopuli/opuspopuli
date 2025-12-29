# Contributing to QCKSTRT

Thank you for your interest in contributing to QCKSTRT! This document explains how to contribute effectively, with special attention to our **fork model** for jurisdiction deployments.

## Table of Contents

- [The Fork Model](#the-fork-model)
- [What Belongs Where](#what-belongs-where)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Community Guidelines](#community-guidelines)

## The Fork Model

QCKSTRT is designed as a **forkable platform** for civic technology. This means:

- **Upstream (this repository)**: Contains the core platform - authentication, AI/ML pipeline, UI components, infrastructure templates, and provider implementations
- **Forks**: Contain region-specific implementations - scrapers, local data, custom configurations, and deployment specifics

```
┌─────────────────────────────────────────────────────────────┐
│                    UPSTREAM (qckstrt)                       │
│  Platform Core: Auth, AI/ML, UI, Providers, Infrastructure  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Fork: CA │    │ Fork: TX │    │ Fork: NY │
        │ Scrapers │    │ Scrapers │    │ Scrapers │
        │ CA Data  │    │ TX Data  │    │ NY Data  │
        └──────────┘    └──────────┘    └──────────┘
```

### Why This Model?

1. **Platform improvements benefit everyone**: Bug fixes and new features flow to all regions
2. **Region data stays local**: Each region controls their own scrapers and data
3. **Distributed infrastructure**: Each deployment runs on its own infrastructure
4. **Unified branding**: All deployments share the Commonwealth Labs network identity

## What Belongs Where

### Contribute to Upstream (this repo)

- Bug fixes in core platform code
- New authentication methods or improvements
- AI/ML pipeline enhancements
- New UI components (accessible, internationalized)
- New provider implementations (databases, LLMs, embeddings)
- Documentation improvements
- Infrastructure template improvements
- The `regions/example/` template (reference implementation only)

### Keep in Your Fork

- Region-specific scrapers (e.g., CA ballot proposition scraper)
- Local data and fixtures
- Custom environment configurations
- Region-specific UI customizations
- Deployment-specific Terraform variables
- Any code that references specific region data sources

### Not Sure?

Ask yourself: "Would this benefit ALL regions, or just mine?"

- **All regions** → Contribute upstream
- **Just mine** → Keep in fork

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker and Docker Compose
- Git

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/CommonwealthLabsCode/qckstrt.git
cd qckstrt

# Install dependencies
pnpm install

# Start infrastructure (Supabase, Ollama)
docker-compose up -d

# Start development servers
pnpm dev
```

See [docs/guides/getting-started.md](docs/guides/getting-started.md) for detailed instructions.

### Creating a Region Fork

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR-ORG/qckstrt.git
cd qckstrt

# Add upstream remote
git remote add upstream https://github.com/CommonwealthLabsCode/qckstrt.git

# Create your region from the example template
cp -r regions/example regions/your-region

# Customize for your region
# Edit regions/your-region/...
```

## Development Workflow

### For Platform Contributions

1. **Fork** the repository (if you haven't already)
2. **Create a branch** from `develop`:
   ```bash
   git checkout develop
   git pull upstream develop
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our code standards
4. **Test thoroughly**:
   ```bash
   pnpm lint
   pnpm test
   ```
5. **Commit** using conventional commits:
   ```bash
   git commit -m "feat: add new authentication provider"
   ```
6. **Push** and create a Pull Request to `develop`

### For Region Development

Work in your fork. To sync platform updates:

```bash
# Fetch upstream changes
git fetch upstream

# Merge platform updates into your fork
git checkout main
git merge upstream/main

# Resolve any conflicts in your region code
```

## Code Standards

### General

- **TypeScript**: All code must be written in TypeScript
- **ESLint**: Run `pnpm lint` before committing
- **Prettier**: Code is auto-formatted on commit
- **Tests**: Add tests for new functionality

### Accessibility

- All UI must meet **WCAG 2.2 Level AA** standards
- Test with keyboard navigation
- Use semantic HTML
- Include ARIA labels where needed

### Internationalization

- All user-facing strings must use `react-i18next`
- Add translations to `locales/en/` and `locales/es/`

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add passkey authentication
fix: resolve login redirect issue
docs: update getting started guide
chore: update dependencies
refactor: simplify auth flow
test: add profile completion tests
```

## Pull Request Process

1. **Fill out the PR template** completely
2. **Ensure CI passes**: Lint, tests, and build must succeed
3. **Request review**: PRs require owner approval (see CODEOWNERS)
4. **Address feedback**: Respond to review comments promptly
5. **Squash and merge**: Maintainers will merge approved PRs

### PR Requirements

- [ ] Follows code standards
- [ ] Tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Documentation updated (if applicable)
- [ ] Accessibility verified (for UI changes)
- [ ] Contains platform code only (not region-specific)

## Community Guidelines

- Be respectful and inclusive
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- Report security issues privately (see [SECURITY.md](SECURITY.md))
- Ask questions in [GitHub Discussions](https://github.com/CommonwealthLabsCode/qckstrt/discussions)

## Getting Help

- **Documentation**: [docs/](docs/)
- **Discussions**: [GitHub Discussions](https://github.com/CommonwealthLabsCode/qckstrt/discussions)
- **Issues**: [GitHub Issues](https://github.com/CommonwealthLabsCode/qckstrt/issues)

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).

---

Thank you for contributing to QCKSTRT and helping build better civic technology!
