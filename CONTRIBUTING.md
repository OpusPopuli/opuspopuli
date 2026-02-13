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

Opus Populi uses a **plugin architecture** — the core platform is a single shared codebase, and region-specific civic data is provided by separate plugin packages. No forking required.

```
┌──────────────────────────────────────────────────────────────┐
│              CORE PLATFORM (this repository)                 │
│  Auth, AI/ML, UI, Providers, Plugin SDK, Infrastructure     │
└──────────────────────────────────────────────────────────────┘
        ↑ imports          ↑ imports          ↑ imports
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ region-      │  │ region-      │  │ region-      │
  │ california   │  │ texas        │  │ new-york     │
  │ (plugin)     │  │ (plugin)     │  │ (plugin)     │
  │ Scrapers     │  │ Scrapers     │  │ Scrapers     │
  │ CA Data      │  │ TX Data      │  │ NY Data      │
  └──────────────┘  └──────────────┘  └──────────────┘
   separate repo     separate repo     separate repo
```

### Why This Model?

1. **No fork maintenance** — Region developers don't need to merge upstream changes; they just update the SDK dependency
2. **Platform improvements benefit everyone** — Bug fixes and features ship to all regions automatically
3. **Region data stays local** — Each region controls their own scrapers, data sources, and validation rules
4. **Clean separation of concerns** — The platform knows nothing about California law; the CA plugin knows nothing about authentication
5. **Plugin ecosystem** — Community-built region plugins extend the platform's reach without centralized effort

## What Belongs Where

### Contribute to This Repo (Core Platform)

- Bug fixes in core platform code
- New authentication methods or improvements
- AI/ML pipeline enhancements
- New UI components (accessible, internationalized)
- New provider implementations (databases, LLMs, embeddings)
- Documentation improvements
- Infrastructure template improvements
- The `@opuspopuli/region-plugin-sdk` and `@opuspopuli/region-provider` packages

### Build as a Region Plugin (Separate Repo)

- Region-specific data source scrapers (e.g., CA Secretary of State)
- Entity resolvers (districts, representatives, jurisdictions)
- Civic data parsers (ballot propositions, meeting transcripts, petitions)
- Region-specific validation rules (petition signature requirements, etc.)
- Seed data (initial districts, jurisdictions)

### Not Sure?

Ask yourself: "Would this benefit ALL regions, or just mine?"

- **All regions** → Contribute to this repo
- **Just mine** → Build it in your region plugin

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

### Creating a Region Plugin

Region-specific civic data is provided via separate plugin packages that implement the `@opuspopuli/region-plugin-sdk` interface:

1. Use the [region-template](https://github.com/OpusPopuli/region-template) GitHub template to create your repo (e.g., `region-california`)
2. Follow the customization checklist in the template README
3. Implement the `IRegionPlugin` interface — data sources, scanners, entity resolvers
4. Publish to GitHub Packages as `@opuspopuli/region-yourregion`
5. Register the plugin in your platform's database configuration

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

### For Region Plugin Development

Work in your own region plugin repo. The plugin SDK provides everything you need:

```bash
# Create from template
gh repo create my-org/region-mystate --template OpusPopuli/region-template

# Install dependencies (includes @opuspopuli/region-plugin-sdk)
cd region-mystate
pnpm install

# Implement your data sources, build, test, publish
pnpm build
pnpm test
pnpm publish
```

To pick up platform improvements, update the SDK dependency:

```bash
pnpm update @opuspopuli/region-plugin-sdk
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
- Ask questions in [GitHub Discussions](https://github.com/OpusPopuli/opuspopuli/discussions)

## Getting Help

- **Documentation**: [docs/](docs/)
- **Discussions**: [GitHub Discussions](https://github.com/OpusPopuli/opuspopuli/discussions)
- **Issues**: [GitHub Issues](https://github.com/OpusPopuli/opuspopuli/issues)

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).

---

Thank you for contributing to Opus Populi and helping build better civic technology!
