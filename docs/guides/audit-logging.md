# Audit Logging Guide

Opus Populi includes a comprehensive audit logging system that automatically captures all GraphQL operations for compliance, security monitoring, and debugging purposes.

## Overview

The audit logging system provides:

- **Automatic capture** of all GraphQL queries and mutations
- **PII masking** for sensitive fields (passwords, tokens, emails)
- **Non-blocking writes** via batched queue for minimal performance impact
- **Configurable retention** with automatic cleanup of old records
- **IP address tracking** with proxy/load balancer support
- **Per-microservice identification** for distributed tracing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GraphQL Request                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              LoggerMiddleware (IP Extraction)               │
│                   Attaches auditContext                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│            GraphQLAuditInterceptor (Global)                 │
│     - Extracts user info, operation details, arguments      │
│     - Auto-infers action type from resolver name            │
│     - Captures success/failure with duration timing         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    AuditLogService                          │
│     - Applies PII masking                                   │
│     - Queues entries for batched writes                     │
│     - Flushes to PostgreSQL (100 entries or 5 seconds)      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│               PostgreSQL (audit_logs table)                 │
│     - JSONB columns for flexible input/output storage       │
│     - Indexed for efficient queries by user, entity, time   │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# Number of days to retain audit logs (0 = indefinite)
AUDIT_RETENTION_DAYS=90

# Cleanup interval in milliseconds (default: 24 hours)
AUDIT_CLEANUP_INTERVAL_MS=86400000
```

### Module Options

You can also configure via `AuditModule.forRoot()`:

```typescript
import { AuditModule } from 'src/common/audit/audit.module';

@Module({
  imports: [
    AuditModule.forRoot({
      enableInterceptor: true,    // Enable global GraphQL interceptor (default: true)
      retentionDays: 90,          // Days to keep logs (default: 90, 0 = indefinite)
      cleanupIntervalMs: 86400000 // Cleanup interval (default: 24 hours)
    })
  ]
})
export class AppModule {}
```

## Audit Log Fields

Each audit log entry captures:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `timestamp` | DateTime | When the operation occurred |
| `action` | Enum | Operation type (CREATE, READ, UPDATE, DELETE, etc.) |
| `entityType` | String | Type of entity accessed (User, Document, etc.) |
| `entityId` | String | ID of the entity (if applicable) |
| `userId` | UUID | User who performed the operation |
| `userEmail` | String | User's email address |
| `requestId` | UUID | Correlation ID for request tracing |
| `ipAddress` | String | Client IP address |
| `userAgent` | String | Client user agent |
| `operationName` | String | GraphQL operation name |
| `operationType` | String | query, mutation, or subscription |
| `resolverName` | String | GraphQL resolver that was called |
| `inputVariables` | JSONB | Input arguments (PII masked) |
| `success` | Boolean | Whether the operation succeeded |
| `statusCode` | Integer | HTTP-like status code |
| `errorMessage` | String | Error message if failed |
| `previousValues` | JSONB | Previous values for updates |
| `newValues` | JSONB | New values for updates |
| `durationMs` | Integer | Operation duration in milliseconds |
| `serviceName` | String | Microservice that processed the request |

## Action Types

The system supports these audit action types:

| Action | Description |
|--------|-------------|
| `LOGIN` | User login |
| `LOGOUT` | User logout |
| `LOGIN_FAILED` | Failed login attempt |
| `PASSWORD_CHANGE` | Password changed |
| `PASSWORD_RESET` | Password reset requested |
| `CREATE` | Entity created |
| `READ` | Entity read |
| `UPDATE` | Entity updated |
| `DELETE` | Entity deleted |
| `BULK_READ` | Multiple entities read |
| `BULK_UPDATE` | Multiple entities updated |
| `BULK_DELETE` | Multiple entities deleted |
| `UPLOAD` | File uploaded |
| `DOWNLOAD` | File downloaded |
| `SEARCH` | Search performed |
| `EXPORT` | Data exported |

## Action Inference

The interceptor automatically infers action types from resolver names:

| Resolver Pattern | Inferred Action |
|-----------------|-----------------|
| `createUser`, `registerUser` | CREATE |
| `updateUser`, `changePassword` | UPDATE |
| `deleteUser`, `removeUser` | DELETE |
| `loginUser` | LOGIN |
| `logoutUser` | LOGOUT |
| `uploadFile`, `indexDocument` | UPLOAD |
| `downloadFile` | DOWNLOAD |
| `searchText`, `searchUsers` | SEARCH |
| `listUsers`, `getUsers`, `findUsers` | BULK_READ |
| `getUser` | READ |

## PII Masking

Sensitive data is automatically masked before storage:

### Fully Redacted Fields
These fields are replaced with `[REDACTED]`:
- `password`, `Password`, `PASSWORD`
- `token`, `accessToken`, `refreshToken`
- `apiKey`, `apiSecret`, `API_KEY`
- `ssn`, `socialSecurityNumber`
- `creditCard`, `cardNumber`
- `secret`, `privateKey`

### Partially Masked Fields
These fields show partial data:
- **Email**: `j**n@example.com`
- **Phone**: `******7890`

### Example

```json
// Input
{
  "email": "john@example.com",
  "password": "secret123",
  "phone": "555-123-4567"
}

// Stored as
{
  "email": "j**n@example.com",
  "password": "[REDACTED]",
  "phone": "******4567"
}
```

## Custom Audit Decorators

For explicit control over audit logging, use the `@Audit` decorator:

```typescript
import { Audit, SkipAudit } from 'src/common/decorators/audit.decorator';
import { AuditAction } from 'src/common/enums/audit-action.enum';

@Resolver()
export class UserResolver {
  // Explicit audit configuration
  @Audit({
    action: AuditAction.LOGIN,
    entityType: 'Auth',
    entityIdArg: 'userId'  // Extract entityId from this argument
  })
  @Mutation()
  async login(@Args('input') input: LoginInput) {
    // ...
  }

  // Skip audit logging for this resolver
  @SkipAudit()
  @Query()
  async healthCheck() {
    return { status: 'ok' };
  }
}
```

## Synchronous Logging

For critical events (login failures, security events), use synchronous logging:

```typescript
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';

@Injectable()
export class AuthService {
  constructor(private auditLogService: AuditLogService) {}

  async login(email: string, password: string) {
    try {
      // ... login logic
    } catch (error) {
      // Immediately persist failed login (doesn't queue)
      await this.auditLogService.logSync({
        requestId: crypto.randomUUID(),
        serviceName: 'users-service',
        action: AuditAction.LOGIN_FAILED,
        success: false,
        userEmail: email,
        errorMessage: error.message,
        ipAddress: '...',
      });
      throw error;
    }
  }
}
```

## Retention Policy

The audit log system automatically cleans up old records:

1. **Cleanup runs on startup** - Removes stale records immediately
2. **Periodic cleanup** - Runs every 24 hours (configurable)
3. **Configurable retention** - Default 90 days, set to 0 for indefinite

### Retention Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `AUDIT_RETENTION_DAYS` | 90 | Days to keep audit logs |
| `AUDIT_CLEANUP_INTERVAL_MS` | 86400000 | How often cleanup runs (24 hours) |

### Setting Indefinite Retention

```bash
# Keep all audit logs forever
AUDIT_RETENTION_DAYS=0
```

## Database Indexes

The audit log table includes indexes for efficient querying:

```sql
-- Query by user and time (user activity reports)
CREATE INDEX idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp);

-- Query by entity (entity history)
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Query by action and time (security analysis)
CREATE INDEX idx_audit_logs_action_timestamp ON audit_logs(action, timestamp);

-- Query by timestamp alone (cleanup, time-based queries)
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
```

## Querying Audit Logs

### Example Queries

```sql
-- Recent failed logins
SELECT * FROM audit_logs
WHERE action = 'LOGIN_FAILED'
  AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- User activity history
SELECT * FROM audit_logs
WHERE user_id = 'uuid-here'
ORDER BY timestamp DESC
LIMIT 100;

-- Document access history
SELECT * FROM audit_logs
WHERE entity_type = 'Document'
  AND entity_id = 'doc-uuid'
ORDER BY timestamp DESC;

-- Operations by service
SELECT service_name, action, COUNT(*)
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY service_name, action;
```

## Performance Considerations

### Batched Writes
- Entries are queued in memory
- Flushed every 5 seconds OR when queue reaches 100 entries
- Failed writes are re-queued for retry

### Non-Blocking
- Uses RxJS `tap()` and `catchError()` operators
- GraphQL responses are not delayed by audit logging
- Synchronous logging (`logSync`) should only be used for critical events

### Graceful Shutdown
- Remaining queue entries are flushed on application shutdown
- Ensures no audit records are lost during deployments

## Integration with Microservices

The audit system is enabled in all three microservices:

- **users-service** (port 3001) - User and auth operations
- **documents-service** (port 3002) - Document operations
- **knowledge-service** (port 3003) - Search and RAG operations

Each service logs with its own `serviceName` for distributed tracing.

## Security Best Practices

1. **Review failed login attempts** regularly for brute force attacks
2. **Monitor bulk operations** for potential data exfiltration
3. **Set appropriate retention** based on compliance requirements
4. **Encrypt database** with at-rest encryption
5. **Restrict access** to audit log queries to authorized personnel

---

**Related Documentation**:
- [System Overview](../architecture/system-overview.md)
- [Getting Started Guide](getting-started.md)
- [Provider Pattern](../architecture/provider-pattern.md)
