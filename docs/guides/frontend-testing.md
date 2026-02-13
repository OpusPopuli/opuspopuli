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
├── __tests__/                  # Jest unit tests
│   ├── Home.test.tsx
│   ├── apollo-client.test.ts
│   ├── apollo-provider.test.tsx
│   ├── auth-context.test.tsx
│   ├── onboarding-context.test.tsx
│   ├── knowledge.test.ts
│   ├── toast.test.tsx
│   ├── useMagicLink.test.ts
│   ├── usePasskey.test.ts
│   ├── rag-demo.test.tsx
│   ├── accessibility/
│   │   └── settings.a11y.test.tsx
│   ├── api/
│   │   └── csp-report.test.ts
│   ├── components/
│   │   ├── Header.test.tsx
│   │   ├── LoadingSpinner.test.tsx
│   │   ├── OfflineIndicator.test.tsx
│   │   ├── ProtectedRoute.test.tsx
│   │   ├── auth/
│   │   │   └── AuthUI.test.tsx
│   │   ├── camera/
│   │   │   ├── CameraCapture.test.tsx
│   │   │   ├── CameraPermission.test.tsx
│   │   │   ├── CameraViewfinder.test.tsx
│   │   │   ├── CaptureControls.test.tsx
│   │   │   ├── CapturePreview.test.tsx
│   │   │   ├── DocumentFrameOverlay.test.tsx
│   │   │   ├── LightingFeedback.test.tsx
│   │   │   └── LocationPrompt.test.tsx
│   │   ├── onboarding/
│   │   │   └── OnboardingSteps.test.tsx
│   │   └── profile/
│   │       ├── CivicFieldsSection.test.tsx
│   │       ├── DemographicFieldsSection.test.tsx
│   │       ├── ProfileCompletionIndicator.test.tsx
│   │       └── ProfileVisibilityToggle.test.tsx
│   ├── config/
│   │   └── security-headers.config.test.ts
│   ├── hooks/
│   │   ├── useCamera.test.ts
│   │   ├── useGeolocation.test.ts
│   │   └── useLightingAnalysis.test.ts
│   ├── pages/
│   │   ├── login.test.tsx
│   │   ├── register.test.tsx
│   │   ├── add-passkey.test.tsx
│   │   ├── auth-callback.test.tsx
│   │   ├── onboarding.test.tsx
│   │   ├── petition-capture.test.tsx
│   │   ├── region/
│   │   ├── settings/
│   │   └── ...
│   └── utils/
│       └── a11y-utils.tsx
├── e2e/                        # Playwright E2E tests
│   ├── accessibility.spec.ts
│   ├── auth.spec.ts
│   ├── email.spec.ts
│   ├── home.spec.ts
│   ├── onboarding.spec.ts
│   ├── petition-capture.spec.ts
│   ├── pwa.spec.ts
│   ├── region.spec.ts
│   └── settings.spec.ts
├── jest.config.js              # Jest configuration
├── jest.setup.js               # Jest setup file
└── playwright.config.ts        # Playwright configuration
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

# Run accessibility unit tests only
pnpm test:a11y
```

### E2E Tests (Playwright)

```bash
# Run all E2E tests
pnpm e2e

# Open Playwright interactive UI
pnpm e2e:ui

# View HTML test report
pnpm e2e:report

# Run accessibility E2E tests only
pnpm e2e:a11y
```

> **Note**: In development, E2E tests automatically start the dev server on port 3200. In CI, tests run against a production build on port 3000.

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
    "!app/(auth)/forgot-password/**",
    "!app/(auth)/reset-password/**",
    "!lib/**/index.ts",
    "!**/*.d.ts",
    "!**/node_modules/**",
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 35,
      statements: 35,
    },
  },
};
```

Per-file thresholds are also configured for critical pages (auth flows, RAG demo) with higher requirements.

**jest.setup.js**:
```javascript
import "@testing-library/jest-dom";
import "@/lib/i18n";
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

**Mock localStorage** (done per-test, not in global setup):
```typescript
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  clear: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });
```

## E2E Testing

### Configuration

**playwright.config.ts**:
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { open: process.env.CI ? "never" : "on-failure" }],
    ["list"],
    ...(process.env.CI ? [["github" as const]] : []),
  ],
  use: {
    baseURL: process.env.CI ? "http://localhost:3000" : "http://localhost:3200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Desktop browsers
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // Mobile devices
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 12"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"] } },
  ],
  webServer: {
    command: process.env.CI
      ? "node .next/standalone/apps/frontend/server.js"
      : "pnpm run dev",
    port: process.env.CI ? 3000 : 3200,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
```

### Writing E2E Tests

**Home Page Tests**:
```typescript
// e2e/home.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the Opus Populi title", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Opus Populi/i })).toBeVisible();
  });

  test("should have a sign in link", async ({ page }) => {
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
```

**Auth Flow Tests**:
```typescript
// e2e/auth.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("should display login form", async ({ page }) => {
    await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  });
});
```

**Onboarding Tests** (with localStorage setup):
```typescript
// e2e/onboarding.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Onboarding", () => {
  test("should show onboarding for new users", async ({ page }) => {
    // Set up new user session via localStorage before navigation
    await page.addInitScript(() => {
      localStorage.removeItem("opuspopuli_onboarding_completed");
    });
    await page.goto("/onboarding");
    await expect(page.getByText(/Welcome/i)).toBeVisible();
  });
});
```

**PWA Tests** (API validation):
```typescript
// e2e/pwa.spec.ts
import { test, expect } from "@playwright/test";

test("manifest should have correct structure", async ({ request }) => {
  const response = await request.get("/api/manifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.name).toBeDefined();
  expect(manifest.display).toBe("standalone");
});
```

### E2E Test Coverage

The E2E test suite covers the following user flows:

| Test File | Coverage |
|-----------|----------|
| `home.spec.ts` | Home page rendering and navigation |
| `auth.spec.ts` | Login, registration, passkey, and magic link flows |
| `onboarding.spec.ts` | First-time user onboarding steps |
| `petition-capture.spec.ts` | Petition scanning with camera |
| `region.spec.ts` | Civic data browsing (propositions, meetings, representatives) |
| `settings.spec.ts` | User settings pages (profile, security, privacy, etc.) |
| `email.spec.ts` | Email history and representative contact |
| `pwa.spec.ts` | Progressive Web App manifest and service worker |
| `accessibility.spec.ts` | WCAG 2.2 AA compliance across pages |

## Coverage Requirements

### Current Thresholds

**Global**:

| Metric | Threshold |
|--------|-----------|
| Statements | 35% |
| Branches | 60% |
| Functions | 60% |
| Lines | 35% |

Per-file thresholds are configured for critical pages with higher requirements (e.g., auth pages, RAG demo page).

### Viewing Coverage

```bash
pnpm test -- --coverage
```

Coverage report is generated in `apps/frontend/coverage/`:
- `coverage/lcov-report/index.html` - HTML report
- `coverage/lcov.info` - LCOV format for CI

### Excluded from Coverage

- `app/**/layout.tsx` - Root layout files
- `app/(auth)/forgot-password/**` - Legacy password flows
- `app/(auth)/reset-password/**` - Legacy password flows
- `lib/**/index.ts` - Re-export barrel files
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
      - run: npx playwright install --with-deps
      - run: pnpm --filter frontend build
      - run: pnpm --filter frontend e2e
```

## Best Practices

### Unit Tests

1. **Test Behavior, Not Implementation** - Focus on what the component does
2. **Use Testing Library Queries** - Prefer `getByRole`, `getByText` over `getByTestId`
3. **Mock External Dependencies** - Mock Apollo, localStorage, etc.
4. **Keep Tests Isolated** - Each test should be independent

### E2E Tests

1. **Test User Flows** - Focus on complete user journeys
2. **Mock API Responses** - Use `page.route()` to intercept network requests
3. **Use `addInitScript`** - Set up localStorage/session state before navigation
4. **Use Accessible Selectors** - Prefer `getByRole`, `getByText` over CSS selectors

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

### Playwright Debugging

```bash
# Open Playwright interactive UI mode
pnpm e2e:ui

# Run with headed browsers (visible)
pnpm e2e -- --headed

# Run with Playwright inspector
PWDEBUG=1 pnpm e2e

# View HTML report after test run
pnpm e2e:report
```

Test artifacts (screenshots, videos, traces) are saved on failure and can be viewed in the HTML report.

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

E2E accessibility tests use `@axe-core/playwright` with a `checkAccessibility()` helper that scans pages against WCAG 2.2 AA criteria:

```typescript
// e2e/accessibility.spec.ts
import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function checkAccessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const violations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );

  expect(violations).toEqual([]);
}

test.describe("Public Pages Accessibility", () => {
  test("home page should have no violations", async ({ page }) => {
    await page.goto("/");
    await checkAccessibility(page);
  });

  test("login page should have no violations", async ({ page }) => {
    await page.goto("/login");
    await checkAccessibility(page);
  });
});

test.describe("Keyboard Navigation", () => {
  test("should be able to tab through form elements", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab");
    const activeElement = page.locator(":focus");
    await expect(activeElement).toBeTruthy();
  });
});

test.describe("HTML Structure", () => {
  test("should have lang attribute", async ({ page }) => {
    await page.goto("/");
    const lang = await page.getAttribute("html", "lang");
    expect(["en", "es"]).toContain(lang);
  });
});
```

The E2E accessibility tests cover:

| Check | WCAG Criterion |
|-------|----------------|
| Decorative icons have `aria-hidden="true"` | 1.1.1 Non-text Content |
| Icon-only buttons have `aria-label` | 4.1.2 Name, Role, Value |
| Form fields have associated labels | 1.3.1 Info and Relationships |
| Color contrast meets requirements | 1.4.3 Contrast (Minimum) |
| HTML `lang` attribute is set | 3.1.1 Language of Page |
| Focus is visible on interactive elements | 2.4.7 Focus Visible |

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
- [Getting Started](getting-started.md)
