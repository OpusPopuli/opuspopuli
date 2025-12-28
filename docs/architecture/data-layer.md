# Data Layer Architecture

## Overview

The data layer uses a dual-database architecture optimized for different data types:

1. **Relational Database** - User data, document metadata, application state
2. **Vector Database** - Document embeddings for semantic search

Both layers use PostgreSQL for data consolidation - relational data via standard PostgreSQL and vectors via the pgvector extension.

## Relational Database Layer

### Purpose
- User profiles and authentication
- Document metadata (filename, upload date, owner, etc.)
- Application state and configuration
- Transactional data

### Provider: PostgreSQL via Supabase (Default)

**When to use**: All environments (development, staging, production)

**Configuration**:
```bash
# Default - PostgreSQL via Supabase
RELATIONAL_DB_PROVIDER=postgres
RELATIONAL_DB_HOST=localhost
RELATIONAL_DB_PORT=5432
RELATIONAL_DB_DATABASE=postgres
RELATIONAL_DB_USERNAME=postgres
RELATIONAL_DB_PASSWORD=your-super-secret-password
```

**Docker Compose**:
```bash
# Start the full Supabase stack
docker-compose up -d
```

This starts PostgreSQL as part of the Supabase stack, along with Auth, Storage, and Vault.

**Pros**:
- ✅ Production-ready from day one
- ✅ ACID compliance
- ✅ Concurrent connections
- ✅ Rich feature set
- ✅ pgvector support (vector + relational)
- ✅ Integrated with Supabase Auth, Storage, Vault

**File Location**: `packages/relationaldb-provider/src/providers/postgres.provider.ts`

---

## Vector Database Layer

### Purpose
- Store document embeddings (384/768-dimensional vectors)
- Perform semantic similarity search
- Support RAG (Retrieval-Augmented Generation)

### Provider: pgvector (Default)

**When to use**: All environments (development, staging, production)

**Configuration**:
```bash
# pgvector uses same PostgreSQL instance
# Falls back to RELATIONAL_DB_* if not specified
VECTOR_DB_HOST=localhost
VECTOR_DB_PORT=5432
VECTOR_DB_DIMENSIONS=384  # Must match embedding model
```

**Setup** (PostgreSQL extension):
```sql
-- Install extension (done automatically by provider)
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

**Pros**:
- ✅ Single database (PostgreSQL + vectors)
- ✅ ACID transactions across relational + vector data
- ✅ Reduced infrastructure complexity
- ✅ Cost savings (one database instead of two)
- ✅ Familiar PostgreSQL tooling
- ✅ Integrated with Supabase stack

**Cons**:
- ❌ Requires PostgreSQL 11+ with pgvector
- ❌ Slightly slower than dedicated vector DBs for very large scale

**File Location**: `packages/vectordb-provider/src/providers/pgvector.provider.ts`

---

## Data Models

### Relational Tables (TypeORM Entities)

#### User Entity
```typescript
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

#### Document Entity
```typescript
@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  filename: string;

  @Column()
  s3Key: string;

  @Column('text')
  content: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
```

### User Profile Data Model

The platform includes a comprehensive user profile system designed for civic applications, with support for GDPR/CCPA compliance. All profile tables have a foreign key to the `users` table with `ON DELETE CASCADE`.

#### UserProfileEntity
Extended user profile data (1:1 with users). Includes civic and demographic fields for personalized AI ballot interpretation.

```typescript
@Entity('user_profiles')
export class UserProfileEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;

  // Personal Information
  firstName?: string;
  middleName?: string;
  lastName?: string;
  displayName?: string;
  preferredName?: string;
  dateOfBirth?: Date;

  // Contact
  phone?: string;
  phoneVerifiedAt?: Date;

  // Preferences
  timezone: string;  // Default: 'America/Los_Angeles'
  locale: string;    // Default: 'en-US'
  preferredLanguage: string;  // Default: 'en'

  // Profile
  avatarUrl?: string;
  avatarStorageKey?: string;  // Supabase storage key for avatar uploads
  bio?: string;

  // Visibility
  isPublic: boolean;  // Default: false (private by default)

  // Civic Fields (for AI ballot interpretation)
  politicalAffiliation?: PoliticalAffiliation;
  votingFrequency?: VotingFrequency;
  policyPriorities?: string[];  // Array of policy priority categories

  // Demographic Fields (optional, privacy-conscious)
  occupation?: string;
  educationLevel?: EducationLevel;
  incomeRange?: IncomeRange;
  householdSize?: string;
  homeownerStatus?: HomeownerStatus;
}

// Civic Enums
enum PoliticalAffiliation {
  DEMOCRAT, REPUBLICAN, INDEPENDENT, LIBERTARIAN, GREEN, OTHER, PREFER_NOT_TO_SAY
}

enum VotingFrequency {
  EVERY_ELECTION, MOST_ELECTIONS, SOME_ELECTIONS, RARELY, NEVER, PREFER_NOT_TO_SAY
}

// Demographic Enums
enum EducationLevel {
  HIGH_SCHOOL, SOME_COLLEGE, ASSOCIATE, BACHELOR, MASTER, DOCTORATE, TRADE_SCHOOL, PREFER_NOT_TO_SAY
}

enum IncomeRange {
  UNDER_25K, RANGE_25K_50K, RANGE_50K_75K, RANGE_75K_100K, RANGE_100K_150K, RANGE_150K_200K, OVER_200K, PREFER_NOT_TO_SAY
}

enum HomeownerStatus {
  OWN, RENT, LIVING_WITH_FAMILY, OTHER, PREFER_NOT_TO_SAY
}
```

#### Profile Completion Tracking
The platform tracks profile completion with weighted scoring to encourage users to provide information that improves AI ballot interpretation:

```typescript
interface ProfileCompletionResult {
  percentage: number;           // 0-130% (100% core + 30% bonus)
  isComplete: boolean;          // true when all core fields are complete
  coreFieldsComplete: {
    hasName: boolean;           // 25% - firstName or displayName
    hasPhoto: boolean;          // 25% - avatarUrl or avatarStorageKey
    hasTimezone: boolean;       // 25% - timezone set
    hasAddress: boolean;        // 25% - at least one address
  };
  suggestedNextSteps: string[]; // Up to 3 suggestions
}

// Bonus points (beyond 100% core):
// - Civic fields: 5% each (up to 15%)
// - Demographic fields: 3% each (up to 15%)
// - Maximum total: 130%
```

#### UserLoginEntity
Login metadata and security tracking (1:1 with users).

```typescript
@Entity('user_logins')
export class UserLoginEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;

  passwordHash?: string;        // Optional legacy support
  lastLoginAt?: Date;
  loginCount: number;           // Default: 0
  failedLoginAttempts: number;  // Default: 0
  lockedUntil?: Date;
}
```

#### UserSessionEntity
Active session tracking with device info (many:1 with users).

```typescript
@Entity('user_sessions')
export class UserSessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;

  // Session tokens
  sessionToken: string;   // Unique
  refreshToken?: string;

  // Device information
  deviceType?: string;    // 'desktop', 'mobile', 'tablet'
  deviceName?: string;    // 'MacBook Pro', 'iPhone 15'
  browser?: string;       // 'Chrome 120'
  operatingSystem?: string;

  // Location
  ipAddress?: string;     // INET type
  city?: string;
  region?: string;
  country?: string;       // ISO 3166-1 alpha-2

  // Status
  isActive: boolean;
  lastActivityAt?: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string; // 'user_logout', 'password_change', etc.
}
```

#### UserAddressEntity
User addresses with geocoding and civic boundary data (many:1 with users). **Critical for civic verticals.**

```typescript
@Entity('user_addresses')
export class UserAddressEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;

  // Classification
  addressType: AddressType;  // 'residential', 'mailing', 'business', 'voting'
  isPrimary: boolean;
  label?: string;            // 'Home', 'Work'

  // Standard address
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;  // Default: 'US'

  // Geocoding data
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  placeId?: string;           // Google Places ID
  geocodedAt?: Date;

  // Civic boundary data (for civic applications)
  congressionalDistrict?: string;      // e.g., 'CA-12'
  stateSenatorialDistrict?: string;
  stateAssemblyDistrict?: string;
  county?: string;
  municipality?: string;
  schoolDistrict?: string;
  precinctId?: string;
  pollingPlace?: string;
  civicDataUpdatedAt?: Date;

  // Verification
  isVerified: boolean;
  verifiedAt?: Date;
  verificationMethod?: string;  // 'usps', 'geocoding', 'manual'
}
```

#### NotificationPreferenceEntity
Email, push, SMS, and civic notification settings (1:1 with users).

```typescript
@Entity('notification_preferences')
export class NotificationPreferenceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;

  // Email notifications
  emailEnabled: boolean;
  emailProductUpdates: boolean;
  emailSecurityAlerts: boolean;
  emailMarketing: boolean;
  emailFrequency: NotificationFrequency;

  // Push notifications
  pushEnabled: boolean;
  pushProductUpdates: boolean;
  pushSecurityAlerts: boolean;
  pushMarketing: boolean;

  // SMS notifications
  smsEnabled: boolean;
  smsSecurityAlerts: boolean;
  smsMarketing: boolean;

  // Civic-specific notifications
  civicElectionReminders: boolean;
  civicVoterDeadlines: boolean;
  civicBallotUpdates: boolean;
  civicLocalNews: boolean;
  civicRepresentativeUpdates: boolean;
  civicFrequency: NotificationFrequency;

  // Quiet hours
  quietHoursEnabled: boolean;
  quietHoursStart?: string;  // 'HH:MM' format
  quietHoursEnd?: string;
}
```

#### UserConsentEntity
GDPR/CCPA consent tracking (many:1 with users).

```typescript
@Entity('user_consents')
export class UserConsentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;

  consentType: ConsentType;   // terms_of_service, privacy_policy, marketing_*, etc.
  status: ConsentStatus;      // 'granted', 'denied', 'withdrawn', 'pending'

  // Version tracking
  documentVersion?: string;   // e.g., '2.1.0'
  documentUrl?: string;

  // Collection metadata (for audit trail)
  ipAddress?: string;
  userAgent?: string;
  collectionMethod?: string;  // 'signup_form', 'settings_page', 'api'

  // Lifecycle timestamps
  grantedAt?: Date;
  deniedAt?: Date;
  withdrawnAt?: Date;
  expiresAt?: Date;

  // Audit
  consentText?: string;       // Actual text user agreed to

  // Unique: one consent record per type per user
  CONSTRAINT UQ_user_consents_userId_consentType UNIQUE (userId, consentType)
}
```

#### PasskeyCredentialEntity
WebAuthn passkey credentials for passwordless authentication (many:1 with users).

```typescript
@Entity('passkey_credentials')
export class PasskeyCredentialEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;

  // WebAuthn credential ID (base64url encoded)
  credentialId: string;  // Unique

  // Public key in COSE format (base64url encoded)
  publicKey: string;

  // Signature counter for replay attack prevention
  counter: number;  // Default: 0

  // AAGUID of the authenticator
  aaguid?: string;

  // Device/authenticator type
  deviceType?: string;  // 'platform', 'cross-platform'

  // Whether the credential is backed up (synced passkey)
  backedUp: boolean;  // Default: false

  // Human-readable name for the passkey
  friendlyName?: string;  // e.g., 'MacBook Pro Touch ID'

  // Transports supported
  transports?: string[];  // ['usb', 'ble', 'nfc', 'internal']

  createdAt: Date;
  lastUsedAt: Date;
}
```

#### WebAuthnChallengeEntity
Temporary storage for WebAuthn challenges (registration/authentication).

```typescript
@Entity('webauthn_challenges')
export class WebAuthnChallengeEntity {
  // Email address or anonymous session identifier
  @PrimaryColumn() identifier: string;

  // The cryptographic challenge (base64url encoded)
  challenge: string;

  // Type of WebAuthn operation
  type: 'registration' | 'authentication';

  createdAt: Date;
  expiresAt: Date;  // Challenges expire after 5 minutes
}
```

### Vector Records

#### pgvector Table
```sql
CREATE TABLE vector_embeddings (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  document_id VARCHAR(255) NOT NULL,
  embedding vector(384) NOT NULL,  -- Dimension matches embedding model
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- HNSW index for fast similarity search
CREATE INDEX idx_embedding_hnsw
  ON vector_embeddings
  USING hnsw (embedding vector_cosine_ops);
```

---

## Embedding Dimensions

Vector databases must match the embedding model's output dimensions:

| Embedding Model | Dimensions | Vector DB Configuration |
|----------------|------------|------------------------|
| Xenova/all-MiniLM-L6-v2 | 384 | `VECTOR_DB_DIMENSIONS=384` |
| Xenova/paraphrase-MiniLM-L3-v2 | 768 | `VECTOR_DB_DIMENSIONS=768` |
| Ollama nomic-embed-text | 768 | `VECTOR_DB_DIMENSIONS=768` |

**Important**: Changing embedding models requires re-indexing all documents!

---

## Database Operations

### Document Indexing Flow

```typescript
// 1. Store document metadata (Relational DB)
const document = await documentRepo.save({
  userId: 'user-1',
  filename: 'report.pdf',
  s3Key: 's3://bucket/report.pdf',
  content: 'Full text...',
});

// 2. Generate embeddings
const { embeddings, texts } = await embeddingsService.getEmbeddingsForText(
  document.content
);

// 3. Store vectors (Vector DB)
await vectorDB.createEmbeddings(
  document.userId,
  document.id,
  embeddings,
  texts
);
```

### Semantic Search Flow

```typescript
// 1. Generate query embedding
const queryEmbedding = await embeddingsService.getEmbeddingsForQuery(
  'What is the status?'
);

// 2. Search similar vectors (Vector DB)
const results = await vectorDB.queryEmbeddings(
  queryEmbedding,
  userId,
  topK: 3
);

// 3. Use results for RAG
const context = results.map(r => r.content).join('\n\n');
const answer = await llm.generate(buildPrompt(context, query));
```

### Document Deletion Flow

```typescript
// 1. Delete from relational DB
await documentRepo.delete(documentId);

// 2. Delete associated vectors
await vectorDB.deleteEmbeddingsByDocumentId(documentId);
```

---

## Performance Considerations

### Relational Database

**Connection Pooling**:
```typescript
{
  type: 'postgres',
  // ... connection details
  extra: {
    max: 10,           // Max connections
    min: 2,            // Min connections
    idleTimeoutMillis: 30000,
  }
}
```

**Indexes**:
```sql
-- User lookups by email
CREATE INDEX idx_users_email ON users(email);

-- Document lookups by user
CREATE INDEX idx_documents_user_id ON documents(user_id);

-- Document lookups by upload date
CREATE INDEX idx_documents_uploaded_at ON documents(uploaded_at DESC);
```

### Vector Database (pgvector)

- HNSW index for approximate nearest neighbor (ANN) search
- Tune `hnsw.m` and `hnsw.ef_construction` for speed vs accuracy tradeoff
- Partition large tables by user_id
- Batch insertions for better performance

```sql
-- Tune HNSW index
CREATE INDEX idx_embedding_hnsw
  ON vector_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);  -- Adjust for your workload
```

---

## Backup and Recovery

### PostgreSQL (includes pgvector data)
```bash
# Backup (includes relational data + vector embeddings)
docker exec qckstrt-supabase-db pg_dump -U postgres postgres > backup.sql

# Restore
docker exec -i qckstrt-supabase-db psql -U postgres postgres < backup.sql
```

**Note**: pg_dump includes pgvector extension and all vector data automatically.

---

## Architecture

### Consolidated Stack (pgvector)
```
All Environments:
  PostgreSQL with pgvector (single database for relational + vectors)
```

This simplifies infrastructure by using a single PostgreSQL database for both relational and vector data.

---

## Monitoring

### Relational Database Metrics
- Connection pool utilization
- Query performance (slow query log)
- Table sizes and growth rate
- Index usage statistics

### Vector Database Metrics
- Embedding storage size
- Query latency (p50, p95, p99)
- Number of vectors per collection
- Index build time

### Health Checks
```typescript
// Relational DB
const isHealthy = await dbProvider.isAvailable();

// Vector DB
const isHealthy = await vectorDB.isAvailable();
```

---

**Related Documentation**:
- [Provider Pattern](provider-pattern.md) - Architecture details
- [Database Migration Guide](../guides/database-migration.md) - Switching providers
- [Getting Started](../guides/getting-started.md) - Setup instructions
