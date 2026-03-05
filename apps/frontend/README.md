# OPUSPOPULI Frontend

React + Next.js frontend with GraphQL integration and passwordless authentication.

## Documentation

See the main documentation:

- **[Getting Started](../../docs/guides/getting-started.md)** - Setup and development
- **[System Overview](../../docs/architecture/system-overview.md)** - Architecture details
- **[Frontend Architecture](../../docs/architecture/frontend-architecture.md)** - Frontend patterns and auth

## Quick Start

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build
pnpm build

# Run tests
pnpm test
```

## Development

The app runs on http://localhost:3200 with hot module replacement (HMR).

## Authentication

Opus Populi uses passwordless-first authentication with three methods:

1. **Passkeys (WebAuthn/FIDO2)** - Primary method using biometric/PIN
2. **Magic Links** - Email-based passwordless login
3. **Password** - Legacy fallback

### Authentication Hooks

```typescript
import { useAuth } from "@/lib/auth-context";
import { usePasskey } from "@/lib/hooks/usePasskey";
import { useMagicLink } from "@/lib/hooks/useMagicLink";

// Access auth state and methods
const { user, isAuthenticated, loginWithPasskey, logout } = useAuth();

// Passkey operations
const { registerPasskey, authenticateWithPasskey, supportsPasskeys } =
  usePasskey();

// Magic link operations
const { sendMagicLink, verifyMagicLink, emailSent } = useMagicLink();
```

### Auth Pages

| Route                   | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `/login`                | Multi-mode login (passkey, magic link, password) |
| `/register`             | Email-first passwordless registration            |
| `/register/add-passkey` | Post-registration passkey setup                  |
| `/auth/callback`        | Magic link verification                          |
| `/forgot-password`      | Request password reset email                     |
| `/reset-password`       | Set new password from reset link                 |

## User Settings

The settings pages provide comprehensive user profile and preference management:

| Route                     | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `/settings`               | Profile settings (name, phone, timezone, bio)   |
| `/settings/addresses`     | Address management with CRUD operations         |
| `/settings/notifications` | Email, push, and civic notification preferences |
| `/settings/privacy`       | GDPR/CCPA consent management                    |
| `/settings/security`      | Passkeys, sessions, and 2FA settings            |
| `/settings/activity`      | Activity log and session management             |

### Settings Features

- **Profile**: Edit personal information with real-time form validation
- **Addresses**: Add/edit/delete addresses, set primary address, view congressional districts
- **Notifications**: Toggle email, push, SMS, and civic notifications with frequency controls
- **Privacy**: Manage consent for marketing, analytics, and data sharing with GDPR/CCPA compliance
- **Security**: Passkey management (placeholder), active session viewing, 2FA setup
- **Activity**: Activity log with filtering, audit trail visualization, and session management

All settings pages use Apollo Client for GraphQL operations with optimistic UI updates.

## Internationalization (i18n)

The frontend supports multiple languages using react-i18next:

- **Supported Languages**: English (en), Spanish (es)
- **Translation Files**: Located in `locales/{lang}/` directory
- **Profile Sync**: Language preference syncs with user's `preferredLanguage` profile field

### Using Translations

```typescript
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation('settings');
  return <label>{t('profile.firstName')}</label>;
}
```

### Language Switching

```typescript
import { useLocale } from "@/lib/i18n/context";

const { locale, setLocale } = useLocale();
setLocale("es"); // Switch to Spanish
```

## Accessibility (WCAG 2.2 AA)

The frontend is designed to meet WCAG 2.2 Level AA accessibility standards:

- **Decorative Icons**: All SVG icons have `aria-hidden="true"`
- **Icon Buttons**: Buttons with only icons include `aria-label` attributes
- **Live Regions**: Language changes are announced to screen readers via `aria-live`
- **Semantic HTML**: Proper heading hierarchy and semantic elements
- **Keyboard Navigation**: All interactive elements are keyboard accessible

See [Frontend Architecture](../../docs/architecture/frontend-architecture.md) for detailed accessibility patterns.

## Petition Scanning

Mobile-friendly petition capture with camera integration:

- **Camera Capture**: Real-time camera with lighting analysis for optimal scan quality
- **OCR Processing**: Automatic text extraction from captured petition images
- **Geolocation**: Location tagging for petition scans
- **Activity Feed**: Real-time petition scanning activity with hourly trends and location counts
- **Map View**: Interactive map showing petition scan locations with clustering

### Petition Hooks

```typescript
import { useCamera } from "@/lib/hooks/useCamera";
import { useLightingAnalysis } from "@/lib/hooks/useLightingAnalysis";
import { useGeolocation } from "@/lib/hooks/useGeolocation";
import { useActivityFeed } from "@/lib/hooks/useActivityFeed";
import { useMapPetitions } from "@/lib/hooks/useMapPetitions";
```

## Transparency Pages

Public-facing transparency documentation:

| Route                          | Purpose                       |
| ------------------------------ | ----------------------------- |
| `/transparency`                | Transparency hub overview     |
| `/transparency/system-card`    | AI system card                |
| `/transparency/ai-commitments` | AI commitments and principles |
| `/transparency/prompt-charter` | Prompt service charter        |

## GraphQL API

The frontend connects to the backend GraphQL API at http://localhost:3000/graphql.

See [Getting Started Guide](../../docs/guides/getting-started.md) for full setup instructions.
