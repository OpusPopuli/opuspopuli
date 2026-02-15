# Contributing to Opus Populi

Thank you for your interest in contributing to Opus Populi! This document explains how to contribute effectively, with special attention to our **plugin architecture** for region-specific civic data.

## Table of Contents

- [The Plugin Architecture](#the-plugin-architecture)
- [What Belongs Where](#what-belongs-where)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Community Guidelines](#community-guidelines)

## The Plugin Architecture

Opus Populi uses a **declarative plugin architecture** — the core platform is a single shared codebase, and region-specific civic data is configured as JSON in the database. No forking, no separate repositories, no scraper code.

```
┌──────────────────────────────────────────────────────────────┐
│              CORE PLATFORM (this repository)                 │
│  Auth, AI/ML, UI, Providers, Scraping Pipeline, Infra       │
├──────────────────────────────────────────────────────────────┤
│  Region Provider (plugin loader, registry, declarative       │
│  plugin bridge) + Scraping Pipeline (AI analysis,            │
│  manifest caching, Cheerio extraction, domain mapping)       │
└──────────────────────────────────────────────────────────────┘
        ↑ auto-discovers JSON files, syncs to DB at startup
  ┌──────────────────────────────────────────────────────┐
  │    packages/region-provider/regions/                   │
  │  ┌────────────┐ ┌────────────┐ ┌────────────┐        │
  │  │california  │ │texas.json  │ │new-york    │  ...   │
  │  │.json       │ │            │ │.json       │        │
  │  │ URLs +     │ │ URLs +     │ │ URLs +     │        │
  │  │ goals      │ │ goals      │ │ goals      │        │
  │  └────────────┘ └────────────┘ └────────────┘        │
  └──────────────────────────────────────────────────────┘
```

### Why This Model?

1. **No code required** — Region developers describe data sources and content goals in JSON; the AI-powered pipeline handles extraction
2. **Platform improvements benefit everyone** — Bug fixes and features ship to all regions automatically
3. **Self-healing extraction** — When websites change their layout, the pipeline re-analyzes and adapts
4. **Clean separation of concerns** — The platform knows nothing about California law; the CA config only describes where to find CA data
5. **Low barrier to entry** — Adding a new region means inserting a database row with URLs and natural language descriptions

## What Belongs Where

### Contribute to This Repo (Core Platform)

- Bug fixes in core platform code
- New authentication methods or improvements
- AI/ML pipeline enhancements
- New UI components (accessible, internationalized)
- New provider implementations (databases, LLMs, embeddings)
- Documentation improvements
- Infrastructure template improvements
- The `@opuspopuli/region-provider` package (declarative plugin system)

### Add a New Region (Declarative Config)

- Create a JSON config file in `packages/region-provider/regions/`
- Describes data source URLs and content goals — no scraper code needed
- Auto-discovered and synced to the database on service startup

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker and Docker Compose
- Git

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/OpusPopuli/opuspopuli.git
cd opuspopuli

# Install dependencies
pnpm install

# Start infrastructure (Supabase, Ollama, Redis, Inbucket)
docker-compose up -d

# Start development servers
pnpm dev
```

See [docs/guides/getting-started.md](docs/guides/getting-started.md) for detailed instructions.

### Adding a Region

Region-specific civic data is configured as JSON files — no scraper code needed. The scraping pipeline handles extraction automatically.

1. Create a JSON config file in `packages/region-provider/regions/` (see `california.json` for an example)
2. Restart the service — configs are auto-synced to the database
3. Enable the plugin: `UPDATE region_plugins SET enabled = true WHERE name = 'my-region';`

See the [Region Provider Guide](docs/guides/region-provider.md) for detailed instructions.

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
   pnpm test              # Unit tests
   pnpm test:integration  # Integration tests (requires docker-compose up)
   ```
5. **Commit** using conventional commits:
   ```bash
   git commit -m "feat: add new authentication provider"
   ```
6. **Push** and create a Pull Request to `develop`

### For Region Configuration

Regions are configured as declarative plugins in the database — no separate repos needed. See the [Region Provider Guide](docs/guides/region-provider.md) for details.

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
- Ask questions in [GitHub Discussions](https://github.com/OpusPopuli/opuspopuli/discussions)

## Getting Help

- **Documentation**: [docs/](docs/)
- **Discussions**: [GitHub Discussions](https://github.com/OpusPopuli/opuspopuli/discussions)
- **Issues**: [GitHub Issues](https://github.com/OpusPopuli/opuspopuli/issues)

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).

---

Thank you for contributing to Opus Populi and helping build better civic technology!
