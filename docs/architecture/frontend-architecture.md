# Frontend Architecture

## Overview

The QCKSTRT frontend is a modern React application built with Next.js 16, React 19, and Tailwind CSS 4. It provides a responsive web interface for interacting with the RAG (Retrieval-Augmented Generation) pipeline.

## Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Framework** | Next.js | 16.x | React framework with App Router |
| **Runtime** | React | 19.x | UI component library |
| **Styling** | Tailwind CSS | 4.x | Utility-first CSS framework |
| **GraphQL Client** | Apollo Client | 4.x | GraphQL state management |
| **Language** | TypeScript | 5.x | Type-safe JavaScript |

## Project Structure

```
apps/frontend/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Home page
│   ├── (auth)/            # Authentication pages (grouped)
│   │   ├── login/         # Login page (multi-mode: passkey/magic-link/password)
│   │   ├── register/      # Registration page (email-first)
│   │   │   └── add-passkey/ # Post-registration passkey setup
│   │   └── auth/
│   │       └── callback/  # Magic link verification callback
│   ├── settings/          # User settings
│   │   └── page.tsx       # Profile, addresses, notifications, privacy
│   └── rag-demo/          # RAG Demo feature
│       └── page.tsx       # RAG Demo page
├── components/             # Reusable UI components
│   └── profile/           # Profile management components
│       ├── AvatarUpload.tsx             # Avatar photo upload
│       ├── ProfileCompletionIndicator.tsx # Progress bar with suggestions
│       ├── ProfileVisibilityToggle.tsx   # Public/private toggle
│       ├── CivicFieldsSection.tsx        # Civic data fields
│       └── DemographicFieldsSection.tsx  # Demographic fields
├── lib/                    # Shared utilities
│   ├── apollo-client.ts   # Apollo Client configuration
│   ├── apollo-provider.tsx # Apollo Provider wrapper
│   ├── auth-context.tsx   # Authentication context and provider
│   ├── hooks/             # Custom React hooks
│   │   ├── usePasskey.ts  # WebAuthn passkey operations
│   │   └── useMagicLink.ts # Magic link operations
│   └── graphql/           # GraphQL operations
│       ├── auth.ts        # Auth queries/mutations
│       ├── profile.ts     # Profile queries/mutations
│       └── knowledge.ts   # Knowledge service queries/mutations
├── __tests__/             # Jest unit tests
├── playwright/            # Playwright E2E tests
│   ├── e2e/              # E2E test specs
│   └── fixtures/         # Test fixtures
├── public/               # Static assets
├── next.config.ts        # Next.js configuration
├── tailwind.config.ts    # Tailwind CSS configuration
├── tsconfig.json         # TypeScript configuration
├── jest.config.js        # Jest configuration
└── playwright.config.ts  # Playwright configuration
```

## Core Architecture

### Next.js App Router

The frontend uses Next.js 16 with the App Router pattern:

```
app/
├── layout.tsx          # Root layout (applies to all pages)
├── page.tsx            # Home page (/)
└── rag-demo/
    └── page.tsx        # RAG Demo page (/rag-demo)
```

**Key Features**:
- Server Components by default for improved performance
- Client Components with `"use client"` directive for interactivity
- File-based routing with nested layouts

### Apollo Client Integration

GraphQL communication with the backend uses Apollo Client 4:

```typescript
// lib/apollo-client.ts
const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
```

**Configuration**:
- HTTP Link pointing to GraphQL Gateway (port 3000)
- Auth Link for adding user headers to requests
- In-memory cache for query results

### GraphQL Operations

All GraphQL queries and mutations are centralized in `lib/graphql/`:

```typescript
// lib/graphql/knowledge.ts
export const INDEX_DOCUMENT = gql`
  mutation IndexDocument($userId: String!, $documentId: String!, $text: String!) {
    indexDocument(userId: $userId, documentId: $documentId, text: $text)
  }
`;

export const ANSWER_QUERY = gql`
  mutation AnswerQuery($userId: String!, $query: String!) {
    answerQuery(userId: $userId, query: $query)
  }
`;
```

**Operations Available**:
- `INDEX_DOCUMENT` - Index text into vector database
- `ANSWER_QUERY` - Ask question with RAG
- `SEARCH_TEXT` - Semantic search without LLM

## State Management

### Client-Side State

The frontend uses a combination of:
- **React useState** - Local component state
- **Apollo Client Cache** - Server state (GraphQL responses)
- **localStorage** - Persistent demo user session

### Demo User Management

For the RAG demo, user sessions are managed via localStorage:

```typescript
interface DemoUser {
  id: string;
  email: string;
  roles: string[];
  department: string;
  clearance: string;
}

// Store user
localStorage.setItem("user", JSON.stringify(demoUser));

// Retrieve user
const user = JSON.parse(localStorage.getItem("user") || "null");
```

## Component Architecture

### Page Components

Page components are React Server Components by default:

```typescript
// app/page.tsx (Server Component)
export default function Home() {
  return <main>...</main>;
}
```

### Client Components

Interactive components use the `"use client"` directive:

```typescript
// app/rag-demo/page.tsx (Client Component)
"use client";

import { useState } from "react";
import { useMutation } from "@apollo/client/react";

export default function RAGDemo() {
  const [query, setQuery] = useState("");
  // ...
}
```

### Provider Hierarchy

The root layout establishes the provider hierarchy:

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ApolloProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ApolloProvider>
      </body>
    </html>
  );
}
```

## Authentication

### Auth Context

The `AuthContext` provides global authentication state and methods:

```typescript
// lib/auth-context.tsx
interface AuthContextType {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  supportsPasskeys: boolean;

  // Passwordless methods
  loginWithPasskey: (email?: string) => Promise<boolean>;
  registerPasskey: (email: string, friendlyName?: string) => Promise<boolean>;
  sendMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;
  verifyMagicLink: (email: string, token: string) => Promise<AuthTokens | null>;
  registerWithMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;

  // Legacy methods
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}
```

### Authentication Hooks

**usePasskey Hook** - WebAuthn operations:
```typescript
// lib/hooks/usePasskey.ts
interface UsePasskeyResult {
  isLoading: boolean;
  error: string | null;
  supportsPasskeys: boolean;
  hasPlatformAuthenticator: boolean;
  passkeys: PasskeyCredential[];

  registerPasskey: (email: string, friendlyName?: string) => Promise<boolean>;
  authenticateWithPasskey: (email?: string) => Promise<AuthTokens | null>;
  deletePasskey: (credentialId: string) => Promise<boolean>;
  refetchPasskeys: () => void;
}
```

**useMagicLink Hook** - Email-based login:
```typescript
// lib/hooks/useMagicLink.ts
interface UseMagicLinkResult {
  isLoading: boolean;
  error: string | null;
  emailSent: boolean;

  sendMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;
  verifyMagicLink: (email: string, token: string) => Promise<AuthTokens | null>;
  registerWithMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;
}
```

### Authentication Pages

| Route | Purpose |
|-------|---------|
| `/login` | Multi-mode login (passkey, magic link, password) |
| `/register` | Email-first registration with magic link |
| `/register/add-passkey` | Post-registration passkey setup |
| `/auth/callback` | Magic link verification callback |

### Login Flow

The login page supports three authentication methods:

```tsx
// Login page with mode selection
const LoginPage = () => {
  const [mode, setMode] = useState<'passkey' | 'magic-link' | 'password'>('passkey');
  const { loginWithPasskey, supportsPasskeys } = useAuth();
  const { sendMagicLink, emailSent } = useMagicLink();

  // Show passkey button if supported (primary)
  // Fall back to magic link or password
};
```

### Registration Flow

Email-first passwordless registration:

```tsx
// Register page - email only, no password
const RegisterPage = () => {
  const { registerWithMagicLink } = useAuth();

  const handleSubmit = async (email: string) => {
    // Send magic link to verify email
    await registerWithMagicLink(email, '/auth/callback?type=register');
    // User clicks link → account created → prompted to add passkey
  };
};
```

## Profile Management

### Profile Components

The frontend includes a comprehensive profile management system with modular components:

| Component | Purpose |
|-----------|---------|
| `AvatarUpload` | Upload profile photos via Supabase Storage presigned URLs |
| `ProfileCompletionIndicator` | Visual progress bar with suggested next steps |
| `ProfileVisibilityToggle` | Toggle profile between public/private |
| `CivicFieldsSection` | Political affiliation, voting frequency, policy priorities |
| `DemographicFieldsSection` | Occupation, education, income, household, homeowner status |

### Profile Completion

The profile completion indicator uses weighted scoring:

```typescript
interface ProfileCompletionResult {
  percentage: number;           // 0-130%
  isComplete: boolean;          // true when core fields complete
  coreFieldsComplete: {
    hasName: boolean;           // 25%
    hasPhoto: boolean;          // 25%
    hasTimezone: boolean;       // 25%
    hasAddress: boolean;        // 25%
  };
  suggestedNextSteps: string[]; // Up to 3 suggestions
}
```

**Scoring**:
- Core fields (100%): Name, Photo, Timezone, Address (25% each)
- Civic bonus (up to 15%): Political affiliation, voting frequency, policy priorities
- Demographic bonus (up to 15%): Occupation, education, income, household, homeowner
- Maximum: 130%

### Avatar Upload Flow

```
1. User clicks avatar → File picker opens
2. Client validates file (type: jpeg/png/webp, size: <5MB)
3. Client shows preview immediately
4. GET_AVATAR_UPLOAD_URL query → Presigned Supabase URL
5. PUT file to presigned URL → Supabase Storage
6. UPDATE_AVATAR_STORAGE_KEY mutation → Profile updated
7. Parent component receives new avatar URL
```

### Profile GraphQL Operations

```typescript
// lib/graphql/profile.ts
export const GET_PROFILE_COMPLETION = gql`
  query GetProfileCompletion {
    myProfileCompletion { percentage isComplete coreFieldsComplete suggestedNextSteps }
  }
`;

export const GET_AVATAR_UPLOAD_URL = gql`
  query GetAvatarUploadUrl($filename: String!) {
    avatarUploadUrl(filename: $filename)
  }
`;

export const UPDATE_AVATAR_STORAGE_KEY = gql`
  mutation UpdateAvatarStorageKey($storageKey: String!) {
    updateAvatarStorageKey(storageKey: $storageKey) { id avatarUrl }
  }
`;

export const UPDATE_MY_PROFILE = gql`
  mutation UpdateMyProfile($input: UpdateProfileInput!) {
    updateMyProfile(input: $input) {
      id firstName lastName displayName timezone isPublic
      politicalAffiliation votingFrequency policyPriorities
      occupation educationLevel incomeRange householdSize homeownerStatus
    }
  }
`;
```

## Styling

### Tailwind CSS 4

The frontend uses Tailwind CSS 4 with the new configuration format:

```css
/* app/globals.css */
@import "tailwindcss";
```

**Features**:
- Utility-first CSS classes
- Dark mode support (`dark:` variants)
- Responsive design (`sm:`, `md:`, `lg:` breakpoints)
- Custom color scheme

### Design Patterns

```tsx
// Common patterns used
<div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
    Title
  </h2>
  <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
    Action
  </button>
</div>
```

## Internationalization (i18n)

The frontend supports multiple languages using **react-i18next**, with English (en) and Spanish (es) as the initial supported languages.

### i18n Architecture

```
ApolloProvider
  └── AuthProvider
        └── I18nProvider (syncs with user's preferredLanguage)
              └── App Components (use useTranslation hook)
```

### Translation Files

```
apps/frontend/locales/
├── en/
│   ├── common.json     # Shared (buttons, errors, status, accessibility)
│   └── settings.json   # Settings pages
└── es/
    ├── common.json
    └── settings.json
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/i18n/index.ts` | i18n configuration and initialization |
| `lib/i18n/context.tsx` | I18nProvider with locale state management |
| `locales/{lang}/common.json` | Shared translations (buttons, errors, status) |
| `locales/{lang}/settings.json` | Settings pages translations |

### Using Translations

```typescript
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation('settings');

  return (
    <label>{t('profile.firstName')}</label>
    <button>{t('common:buttons.save')}</button>
  );
}
```

### Language Switching

```typescript
import { useLocale } from '@/lib/i18n/context';

function LanguageSelector() {
  const { locale, setLocale } = useLocale();

  return (
    <select value={locale} onChange={(e) => setLocale(e.target.value)}>
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  );
}
```

### Language Sync Behavior

1. **Authenticated users**: Language syncs with profile's `preferredLanguage` field
2. **Language selector**: Changes locale immediately + persists to profile
3. **Unauthenticated users**: Falls back to browser language or English
4. **HTML lang attribute**: Updated dynamically via `document.documentElement.lang`

### Translation Namespaces

| Namespace | Purpose |
|-----------|---------|
| `common` | Shared UI elements (buttons, errors, status badges) |
| `settings` | Settings pages (profile, addresses, notifications, privacy, security) |

### Profile-Specific Translation Keys

The profile enhancements include comprehensive translations:

```json
{
  "profile": {
    "completion": { "title", "percentage", "nextSteps", "complete" },
    "visibility": { "label", "public", "private", "hint" },
    "avatar": { "upload", "change", "hint", "errorInvalidType", "errorTooLarge" },
    "civic": {
      "title", "politicalAffiliation", "votingFrequency", "policyPriorities",
      "affiliations": { "democrat", "republican", "independent", ... },
      "frequencies": { "everyElection", "mostElections", ... },
      "policies": { "healthcare", "economy", "education", ... }
    },
    "demographic": {
      "title", "occupation", "educationLevel", "incomeRange", "householdSize", "homeownerStatus",
      "education": { "highSchool", "bachelor", "master", ... },
      "income": { "under25k", "25k50k", ... },
      "homeowner": { "own", "rent", ... }
    }
  }
}
```

## Accessibility (WCAG 2.2 AA)

The frontend is designed to meet **WCAG 2.2 Level AA** accessibility standards.

### Accessibility Patterns

#### Decorative Icons

All decorative SVG icons include `aria-hidden="true"` to hide them from screen readers:

```tsx
<svg className="w-5 h-5" aria-hidden="true">
  <path ... />
</svg>
```

#### Icon-Only Buttons

Buttons that contain only icons include accessible labels:

```tsx
<button
  onClick={handleEdit}
  aria-label={t("common:buttons.edit")}
>
  <svg className="w-5 h-5" aria-hidden="true">...</svg>
</button>
```

#### Live Regions for Dynamic Content

The I18nProvider includes an ARIA live region to announce language changes to screen readers:

```tsx
<output
  aria-live="polite"
  aria-atomic="true"
  className="sr-only"
  style={{
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  }}
>
  {announcement}
</output>
```

### WCAG 2.2 AA Compliance Checklist

| Criterion | Implementation |
|-----------|----------------|
| **1.1.1 Non-text Content** | `aria-hidden="true"` on decorative icons |
| **1.3.1 Info and Relationships** | Semantic HTML, proper heading hierarchy |
| **2.1.1 Keyboard** | All interactive elements focusable |
| **2.4.4 Link Purpose** | Clear link text and button labels |
| **3.1.1 Language of Page** | Dynamic `lang` attribute on `<html>` |
| **3.1.2 Language of Parts** | Translations via react-i18next |
| **4.1.2 Name, Role, Value** | `aria-label` on icon-only buttons |
| **4.1.3 Status Messages** | `aria-live` regions for dynamic updates |

### Accessibility Translation Keys

The `common.json` translation files include accessibility-specific keys:

```json
{
  "accessibility": {
    "languageChanged": "Language changed to English"
  }
}
```

### Testing Accessibility

The frontend tests verify accessibility by querying elements using accessible names:

```typescript
// Query buttons by accessible name (aria-label)
const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
const editButton = screen.getByRole("button", { name: "Edit" });
```

## API Communication

### GraphQL Endpoint

The frontend communicates with the backend via GraphQL:

```
Frontend (Next.js)
    ↓ GraphQL
API Gateway (Port 3000)
    ↓ Federation
Microservices (Users, Documents, Knowledge, Files)
```

### Request Flow

1. **User Action** - Button click, form submit
2. **GraphQL Mutation/Query** - Apollo Client sends request
3. **Auth Header** - Demo user ID added to headers
4. **API Gateway** - Routes to appropriate service
5. **Response** - Data returned and cached

### Error Handling

```typescript
try {
  const result = await answerQuery({ variables: { userId, query } });
  setAnswer(result.data?.answerQuery || "No answer");
} catch (error) {
  setAnswer(`Error: ${error.message}`);
}
```

## Performance Considerations

### Next.js Optimizations

- **Server Components** - Reduce client JavaScript bundle
- **Automatic Code Splitting** - Per-page bundles
- **Image Optimization** - Next.js Image component
- **Font Optimization** - Next.js Font component

### Apollo Client Optimizations

- **In-Memory Cache** - Avoid redundant network requests
- **Query Deduplication** - Prevent duplicate simultaneous requests
- **Normalized Cache** - Efficient updates

## Security

### Authentication

The frontend uses **passwordless-first authentication** with three methods:

1. **Passkeys (WebAuthn/FIDO2)** - Primary method using biometric/PIN
2. **Magic Links** - Email-based passwordless login
3. **Password** - Legacy fallback for compatibility

**Token Storage**:
```typescript
// JWT tokens stored securely
localStorage.setItem('accessToken', tokens.accessToken);
localStorage.setItem('refreshToken', tokens.refreshToken);

// Headers sent with each GraphQL request
headers: {
  Authorization: `Bearer ${accessToken}`,
}
```

**WebAuthn Browser Support**:
```typescript
// Check for passkey support on mount
const webAuthnSupported = browserSupportsWebAuthn();
const platformAvailable = await platformAuthenticatorIsAvailable();
```

### Protected Routes

Routes are protected via the AuthContext:

```tsx
// Protected route wrapper (using Next.js redirect)
import { redirect } from 'next/navigation';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) redirect('/login');
  return children;
};
```

### Production Security

- HTTPS required for WebAuthn (except localhost)
- Magic link tokens expire after 2 hours
- Passkey challenges expire after 5 minutes
- JWT access tokens with short expiration
- Refresh token rotation

## Environment Configuration

### Development

```bash
# .env.local (optional)
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3000/graphql
```

### Production

```bash
# Environment variables for production
NEXT_PUBLIC_GRAPHQL_URL=https://api.yourapp.com/graphql
```

## Build & Deployment

### Development Server

```bash
pnpm dev          # Start dev server on port 3000
```

### Production Build

```bash
pnpm build        # Create production build
pnpm start        # Start production server
```

### Docker Deployment

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN pnpm build

FROM node:20-alpine
COPY --from=builder /app/.next .next
COPY --from=builder /app/public public
CMD ["pnpm", "start"]
```

## Related Documentation

- [System Overview](system-overview.md) - Overall architecture
- [RAG Demo Guide](../guides/frontend-rag-demo.md) - Using the RAG demo
- [Frontend Testing](../guides/frontend-testing.md) - Testing guide
- [Getting Started](../guides/getting-started.md) - Development setup
- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) - Full accessibility guidelines
- [react-i18next Documentation](https://react.i18next.com/) - i18n library docs
