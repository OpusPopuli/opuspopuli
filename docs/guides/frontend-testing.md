# Frontend Testing Guide

This guide covers the testing strategy and practices for the Opus Populi frontend application.

## Overview

The frontend uses a comprehensive testing approach:

| Test Type | Framework | Purpose |
|-----------|-----------|---------|
| **Unit Tests** | Jest + Testing Library | Component logic, utilities |
| **Accessibility Tests** | jest-axe + @axe-core/playwright | WCAG 2.2 AA compliance |
| **E2E Tests** | Playwright | Full user flows |

## Test Structure

```
apps/frontend/
├── __tests__/              # Jest unit tests
│   ├── apollo-client.test.ts
│   ├── apollo-provider.test.tsx
│   ├── Home.test.tsx
│   └── knowledge.test.ts
├── cypress/                # Cypress E2E tests
│   ├── e2e/
│   │   ├── home.cy.ts
│   │   └── rag-demo.cy.ts
│   ├── fixtures/
│   │   └── example.json
│   ├── support/
│   │   ├── commands.ts
│   │   └── e2e.ts
│   └── tsconfig.json
├── jest.config.js          # Jest configuration
├── jest.setup.js           # Jest setup file
└── cypress.config.ts       # Cypress configuration
```

## Running Tests

### Unit Tests (Jest)

```bash
# Run all unit tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Watch mode for development
pnpm test:watch

# Run specific test file
pnpm test -- apollo-client.test.ts
```

### E2E Tests (Cypress)

```bash
# Open Cypress interactive mode
pnpm cypress:open

# Run headless (CI mode)
pnpm cypress:run
# or
pnpm e2e
```

> **Note**: E2E tests require the frontend to be running (`pnpm dev`)

## Unit Testing

### Configuration

**jest.config.js**:
```javascript
const config = {
  preset: "ts-jest",
  testEnvironment: "jest-environment-jsdom",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "!app/**/layout.tsx",
    "!app/rag-demo/**",  // Complex Apollo hooks - tested via E2E
    "!**/*.d.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

### Testing Components

**Basic Component Test**:
```typescript
// __tests__/Home.test.tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Home from "../app/page";

it("should display Opus Populi title", () => {
  render(<Home />);
  const title = screen.getByText(/Opus Populi/i);
  expect(title).toBeInTheDocument();
});
```

**Component with Provider**:
```typescript
// __tests__/apollo-provider.test.tsx
import { render, screen } from "@testing-library/react";
import { ApolloProvider } from "../lib/apollo-provider";

it("should render children", () => {
  render(
    <ApolloProvider>
      <div data-testid="child">Test Child</div>
    </ApolloProvider>
  );
  expect(screen.getByTestId("child")).toBeInTheDocument();
});
```

### Testing Utilities

**Apollo Client Utilities**:
```typescript
// __tests__/apollo-client.test.ts
import { setDemoUser, getDemoUser, clearDemoUser } from "../lib/apollo-client";

describe("setDemoUser", () => {
  it("should store user in localStorage", () => {
    const user = {
      id: "test-id",
      email: "test@example.com",
      roles: ["user"],
    };
    setDemoUser(user);
    const stored = localStorage.getItem("user");
    expect(stored).toBe(JSON.stringify(user));
  });
});
```

### Testing GraphQL Operations

**GraphQL Types/Operations**:
```typescript
// __tests__/knowledge.test.ts
import {
  INDEX_DOCUMENT,
  ANSWER_QUERY,
  IndexDocumentData,
} from "../lib/graphql/knowledge";

describe("GraphQL operations", () => {
  it("INDEX_DOCUMENT should have correct structure", () => {
    expect(INDEX_DOCUMENT).toBeDefined();
    const source = INDEX_DOCUMENT.loc?.source.body;
    expect(source).toContain("mutation IndexDocument");
    expect(source).toContain("$userId: String!");
  });
});
```

### Mocking

**Mock localStorage**:
```typescript
// jest.setup.js (automatically configured)
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;
```

**Mock Apollo Client**:
```typescript
import { MockedProvider } from "@apollo/client/testing";

const mocks = [
  {
    request: {
      query: ANSWER_QUERY,
      variables: { userId: "user-1", query: "test" },
    },
    result: {
      data: { answerQuery: "Mocked answer" },
    },
  },
];

render(
  <MockedProvider mocks={mocks}>
    <Component />
  </MockedProvider>
);
```

## E2E Testing

### Configuration

**cypress.config.ts**:
```typescript
import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
```

### Custom Commands

**cypress/support/commands.ts**:
```typescript
// Login command
Cypress.Commands.add("demoLogin", (email = "demo@example.com") => {
  const demoUser = {
    id: crypto.randomUUID(),
    email,
    roles: ["user"],
    department: "demo",
    clearance: "public",
  };
  cy.window().then((win) => {
    win.localStorage.setItem("user", JSON.stringify(demoUser));
  });
});

// GraphQL mock command
Cypress.Commands.add("mockGraphQL", (operationName, response) => {
  cy.intercept("POST", "**/graphql", (req) => {
    if (req.body.query?.includes(operationName)) {
      req.reply({ data: response });
    }
  }).as(operationName);
});
```

### Writing E2E Tests

**Home Page Tests**:
```typescript
// cypress/e2e/home.cy.ts
describe("Home Page", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("should display the Opus Populi title", () => {
    cy.contains("Opus Populi").should("be.visible");
  });

  it("should navigate to RAG Demo page", () => {
    cy.contains("RAG Demo").click();
    cy.url().should("include", "/rag-demo");
  });
});
```

**RAG Demo Tests**:
```typescript
// cypress/e2e/rag-demo.cy.ts
describe("RAG Demo Page", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit("/rag-demo");
  });

  describe("Login Flow", () => {
    it("should login successfully", () => {
      cy.get('input[type="email"]').type("test@example.com");
      cy.contains("button", "Start Demo Session").click();
      cy.contains("RAG Pipeline Demo").should("be.visible");
    });
  });

  describe("With Mocked API", () => {
    beforeEach(() => {
      // Login first
      cy.get('input[type="email"]').type("demo@example.com");
      cy.contains("Start Demo Session").click();
    });

    it("should handle answer query", () => {
      cy.intercept("POST", "**/graphql", (req) => {
        if (req.body.query?.includes("answerQuery")) {
          req.reply({
            data: { answerQuery: "Mocked answer from RAG" },
          });
        }
      }).as("answerQuery");

      cy.contains("Query Knowledge Base").click();
      cy.get('input[placeholder*="main topics"]').type("Test question");
      cy.contains("Ask Question (RAG)").click();
      cy.wait("@answerQuery");
      cy.contains("Mocked answer from RAG").should("be.visible");
    });
  });
});
```

### Testing Patterns

**Waiting for API Calls**:
```typescript
cy.intercept("POST", "**/graphql").as("graphql");
cy.contains("button", "Submit").click();
cy.wait("@graphql");
cy.contains("Success").should("be.visible");
```

**Testing Forms**:
```typescript
cy.get('input[name="email"]').type("user@example.com");
cy.get('textarea').type("Document content here");
cy.get('button[type="submit"]').click();
```

**Testing localStorage**:
```typescript
cy.window().then((win) => {
  const user = JSON.parse(win.localStorage.getItem("user"));
  expect(user.email).to.equal("test@example.com");
});
```

## Coverage Requirements

### Current Thresholds

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 80% |
| Functions | 80% |
| Lines | 80% |

### Viewing Coverage

```bash
pnpm test -- --coverage
```

Coverage report is generated in `apps/frontend/coverage/`:
- `coverage/lcov-report/index.html` - HTML report
- `coverage/lcov.info` - LCOV format for CI

### Excluded from Coverage

- `app/**/layout.tsx` - Root layout files
- `app/rag-demo/**` - Complex Apollo hooks tested via E2E
- `**/*.d.ts` - TypeScript declaration files

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Frontend Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install
      - run: pnpm --filter frontend test -- --coverage

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4

      - run: pnpm install
      - run: pnpm --filter frontend build
      - run: pnpm --filter frontend start &
      - run: npx wait-on http://localhost:3000
      - run: pnpm --filter frontend cypress:run
```

## Best Practices

### Unit Tests

1. **Test Behavior, Not Implementation** - Focus on what the component does
2. **Use Testing Library Queries** - Prefer `getByRole`, `getByText` over `getByTestId`
3. **Mock External Dependencies** - Mock Apollo, localStorage, etc.
4. **Keep Tests Isolated** - Each test should be independent

### E2E Tests

1. **Test User Flows** - Focus on complete user journeys
2. **Mock API Responses** - Don't depend on backend for E2E tests
3. **Clear State Between Tests** - Use `beforeEach` to reset localStorage
4. **Use Custom Commands** - DRY up common operations

### General

1. **Descriptive Test Names** - "should display error when form is invalid"
2. **Arrange-Act-Assert** - Clear structure in each test
3. **Avoid Test Interdependence** - Tests should run in any order
4. **Test Edge Cases** - Empty states, errors, loading states

## Debugging Tests

### Jest Debugging

```bash
# Run single test with verbose output
pnpm test -- --verbose apollo-client.test.ts

# Debug with node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Cypress Debugging

```bash
# Open Cypress in debug mode
DEBUG=cypress:* pnpm cypress:open

# Take screenshots on failure (automatic in CI)
# Check cypress/screenshots/ after failures
```

## Accessibility Testing

The frontend includes automated WCAG 2.2 AA accessibility testing using `jest-axe` for unit tests and `@axe-core/playwright` for E2E tests.

### Running Accessibility Tests

```bash
# Run Jest accessibility tests only
pnpm test:a11y

# Run Playwright accessibility tests
pnpm e2e:a11y
```

### Jest Accessibility Tests

Accessibility tests are located in `__tests__/accessibility/`:

```typescript
// __tests__/accessibility/settings.a11y.test.tsx
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import ProfileSettingsPage from "@/app/settings/page";

expect.extend(toHaveNoViolations);

describe("Profile Settings Accessibility", () => {
  it("should have no accessibility violations", async () => {
    const { container } = render(<ProfileSettingsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### Playwright Accessibility Tests

E2E accessibility tests use `@axe-core/playwright`:

```typescript
// e2e/accessibility.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("page should have no WCAG 2.2 AA violations", async ({ page }) => {
  await page.goto("/");

  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
});
```

### What Gets Tested

The accessibility tests verify:

| Check | WCAG Criterion |
|-------|----------------|
| Decorative icons have `aria-hidden="true"` | 1.1.1 Non-text Content |
| Icon-only buttons have `aria-label` | 4.1.2 Name, Role, Value |
| Form fields have associated labels | 1.3.1 Info and Relationships |
| Color contrast meets requirements | 1.4.3 Contrast (Minimum) |
| HTML `lang` attribute is set | 3.1.1 Language of Page |
| Focus is visible on interactive elements | 2.4.7 Focus Visible |

### Adding Accessibility Tests

When adding new components, include accessibility tests:

1. **Check for axe violations** - Use `jest-axe` to scan the rendered component
2. **Verify ARIA attributes** - Ensure decorative elements have `aria-hidden`
3. **Test keyboard navigation** - Verify focusable elements are accessible
4. **Check accessible names** - Buttons and links should have clear labels

### Accessibility Test Utilities

A utility file is available at `__tests__/utils/a11y-utils.tsx`:

```typescript
import { configureAxe, toHaveNoViolations } from "jest-axe";

// Configure axe with WCAG 2.2 AA rules
export const axe = configureAxe({
  rules: {
    "color-contrast": { enabled: true },
    "button-name": { enabled: true },
    "image-alt": { enabled: true },
    // ... more rules
  },
});
```

## Related Documentation

- [Frontend Architecture](../architecture/frontend-architecture.md) - Includes accessibility patterns
- [RAG Demo Guide](frontend-rag-demo.md)
- [Getting Started](getting-started.md)
