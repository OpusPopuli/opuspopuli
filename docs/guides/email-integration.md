# Email Integration Guide

This guide covers the email integration using Resend for transactional emails.

## Overview

The platform uses Resend for sending transactional emails while keeping Supabase Auth for authentication-related emails (password reset, magic links). This separation allows:

- **Supabase Auth**: Handles auth emails (password reset, magic links, verification)
- **Resend**: Handles platform emails (welcome, representative contact, civic notifications)

## Features

### Current Implementation

1. **Welcome Emails** - Sent automatically after user registration
2. **Representative Contact** - Users can email their representatives about propositions/issues
3. **Email History** - Users can view their sent email correspondence
4. **Mailto Fallback** - Option to open emails in user's email client

### Future Features (Planned)

- Civic update notifications
- Election reminders
- Ballot update alerts
- Account activity notifications

## Architecture

### Package Structure

```
packages/email-provider/
├── package.json
├── tsconfig.json
├── jest.config.js
├── src/
│   ├── index.ts              # Package exports
│   ├── email.module.ts       # NestJS dynamic module
│   ├── email.service.ts      # Service wrapper
│   ├── providers/
│   │   └── resend.provider.ts    # Resend API implementation
│   └── templates/
│       ├── welcome.template.ts               # Welcome email template
│       └── representative-contact.template.ts # Rep contact template
└── __tests__/
    └── resend.provider.spec.ts   # Unit tests
```

### Backend Domain Module

```
apps/backend/src/apps/users/src/domains/email/
├── email.module.ts           # Domain module
├── email.service.ts          # Business logic
├── email.resolver.ts         # GraphQL API
├── email.service.spec.ts     # Service tests
├── email.resolver.spec.ts    # Resolver tests
├── dto/
│   ├── contact-representative.dto.ts
│   └── send-email.dto.ts
└── models/
    └── email-correspondence.model.ts
```

### Database Entity

```typescript
// EmailCorrespondenceEntity tracks all sent emails
@Entity('email_correspondence')
export class EmailCorrespondenceEntity {
  id: string;           // UUID
  userId: string;       // User who sent the email
  emailType: EmailType; // WELCOME, REPRESENTATIVE_CONTACT, etc.
  status: EmailStatus;  // PENDING, SENT, DELIVERED, FAILED, BOUNCED

  recipientEmail: string;
  recipientName?: string;
  subject: string;
  bodyPreview?: string; // First 500 characters

  // Representative contact specific
  representativeId?: string;
  representativeName?: string;
  propositionId?: string;
  propositionTitle?: string;

  // Tracking
  resendId?: string;
  errorMessage?: string;
  sentAt?: Date;
  deliveredAt?: Date;
}
```

## Configuration

### Environment Variables

```bash
# Required
RESEND_API_KEY=re_xxxxxxxxxxxxx

# Optional (with defaults)
EMAIL_FROM_ADDRESS=noreply@commonwealthlabs.io
EMAIL_FROM_NAME=Commonwealth Labs
EMAIL_REPLY_TO=support@commonwealthlabs.io
FRONTEND_URL=https://app.commonwealthlabs.io
```

### Getting a Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Create an API key in the dashboard
3. Verify your sending domain (required for production)
4. Add the API key to your `.env` file

## GraphQL API

### Queries

```graphql
# Get user's email history
query MyEmailHistory($skip: Int, $take: Int, $emailType: EmailType) {
  myEmailHistory(skip: $skip, take: $take, emailType: $emailType) {
    items {
      id
      emailType
      status
      recipientEmail
      recipientName
      subject
      bodyPreview
      representativeName
      propositionTitle
      errorMessage
      sentAt
      createdAt
    }
    total
    hasMore
  }
}

# Get mailto link for email client fallback
query RepresentativeMailtoLink($email: String!, $subject: String!, $body: String!) {
  representativeMailtoLink(
    representativeEmail: $email
    subject: $subject
    body: $body
  )
}
```

### Mutations

```graphql
# Contact a representative
mutation ContactRepresentative(
  $input: ContactRepresentativeInput!
  $representative: RepresentativeInfoInput!
  $proposition: PropositionInfoInput
) {
  contactRepresentative(
    input: $input
    representative: $representative
    proposition: $proposition
  ) {
    success
    correspondenceId
    error
  }
}
```

## Frontend Components

### Contact Representative Form

```tsx
import { ContactRepresentativeForm } from "@/components/email/ContactRepresentativeForm";

<ContactRepresentativeForm
  representative={{
    id: "rep-123",
    name: "Rep. Jane Smith",
    email: "jane.smith@congress.gov",
    chamber: "House"
  }}
  proposition={{
    id: "prop-456",
    title: "Climate Action Initiative"
  }}
  onSuccess={() => setShowModal(false)}
  onCancel={() => setShowModal(false)}
/>
```

### Email History Page

The email history page is available at `/settings/email-history` and shows:

- Sent emails with status badges (Pending, Sent, Delivered, Failed, Bounced)
- Email type filtering
- Pagination
- Error messages for failed emails

## Email Templates

### Welcome Email

```typescript
// packages/email-provider/src/templates/welcome.template.ts
export function generateWelcomeEmail(userName: string, platformName: string, loginUrl: string) {
  return {
    subject: `Welcome to ${platformName}!`,
    html: `...`, // HTML template
    text: `...`  // Plain text fallback
  };
}
```

### Representative Contact Email

```typescript
// packages/email-provider/src/templates/representative-contact.template.ts
export function generateRepresentativeContactEmail(
  recipientName: string,
  senderName: string,
  senderEmail: string,
  subject: string,
  message: string,
  propositionTitle?: string,
  senderAddress?: string,
  platformName: string = "Commonwealth Labs"
) {
  return {
    html: `...`, // Professional HTML template
    text: `...`  // Plain text fallback
  };
}
```

## Consent Management

Users must grant consent before contacting representatives. The system checks for `REPRESENTATIVE_CONTACT` consent:

```typescript
// EmailService.contactRepresentative
const consent = await this.consentRepo.findOne({
  where: {
    userId,
    consentType: ConsentType.REPRESENTATIVE_CONTACT,
    status: ConsentStatus.GRANTED,
  },
});

if (!consent) {
  throw new ForbiddenException('Representative contact consent not granted');
}
```

## Testing

### Unit Tests

```bash
# Run email provider tests
pnpm test --filter @qckstrt/email-provider

# Run backend email domain tests
cd apps/backend && pnpm test -- --testPathPatterns="domains/email"
```

### E2E Tests

```bash
# Run email e2e tests
cd apps/frontend && pnpm e2e e2e/email.spec.ts
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| ResendEmailProvider | 15 | 100% |
| EmailService | 21 | 100% statements, 94% branches |
| EmailResolver | 12 | 100% statements |
| E2E (email.spec.ts) | 26 | UI flows, accessibility |

## Error Handling

### Provider Errors

```typescript
// EmailError is thrown for provider failures
export class EmailError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'EmailError';
  }
}
```

### Status Tracking

Email status is tracked in the database:

- `PENDING` - Email queued for sending
- `SENT` - Email sent to Resend
- `DELIVERED` - Email delivered (via webhook, future)
- `FAILED` - Send failed (error stored in `errorMessage`)
- `BOUNCED` - Email bounced (via webhook, future)

## Adding New Email Types

### 1. Add Email Type Enum

```typescript
// apps/backend/src/db/entities/email-correspondence.entity.ts
export enum EmailType {
  WELCOME = 'WELCOME',
  REPRESENTATIVE_CONTACT = 'REPRESENTATIVE_CONTACT',
  CIVIC_UPDATE = 'CIVIC_UPDATE',        // Add new type
  ELECTION_REMINDER = 'ELECTION_REMINDER',
  BALLOT_UPDATE = 'BALLOT_UPDATE',
  ACCOUNT_ACTIVITY = 'ACCOUNT_ACTIVITY',
}
```

### 2. Create Template

```typescript
// packages/email-provider/src/templates/civic-update.template.ts
export function generateCivicUpdateEmail(...) {
  return { subject, html, text };
}
```

### 3. Add Service Method

```typescript
// apps/backend/src/apps/users/src/domains/email/email.service.ts
async sendCivicUpdate(userId: string, email: string, update: CivicUpdate) {
  // Implementation
}
```

### 4. Add Tests

Create unit tests for the new template and service method.

## Best Practices

1. **Always include plain text fallback** - Some email clients don't render HTML
2. **Use proper reply-to headers** - Enable replies to go to the user, not the platform
3. **Include tags for analytics** - Track email types and related entities
4. **Store email history** - Users should see what they've sent
5. **Handle failures gracefully** - Don't break user flows on email failures
6. **Rate limit sending** - Prevent abuse of the email system

## Related Documentation

- [Provider Pattern](../architecture/provider-pattern.md) - Provider architecture
- [Frontend Architecture](../architecture/frontend-architecture.md) - Frontend components
- [Audit Logging](audit-logging.md) - Email events are logged for compliance
