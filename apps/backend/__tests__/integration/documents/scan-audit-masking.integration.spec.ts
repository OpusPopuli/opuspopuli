/**
 * #1144 — the audit pipeline must never persist scan image payloads.
 *
 * ScanService deliberately never stores the photograph (location:
 * 'not-stored', hash-only), but the global audit interceptor captures
 * GraphQL args verbatim, and `ProcessScanInput.data` — the entire base64
 * image — was landing unredacted, identity-linked, in 90-day audit logs.
 *
 * This drives the REAL write path: AuditLogService.logSync against the real
 * database with a processScan-shaped entry, then reads the persisted row
 * back. The unit tests on the masker prove the function; this proves the
 * boundary — a regression anywhere between interceptor shape and DB row
 * (a maskEntry bypass, a new write path) fails here.
 */
import { getDbService } from '../utils/db-cleanup';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { AuditLogService } from 'src/common/services/audit-log.service';
import type { DbService } from '@opuspopuli/relationaldb-provider';

describe('scan audit masking (#1144)', () => {
  let db: DbService;
  let audit: AuditLogService;

  // Unmistakable in a row dump, impossible to match accidentally.
  const SENTINEL = 'iVBORw0KGgo_LEAKED_SCAN_PAYLOAD_1144_' + 'A'.repeat(128);

  beforeAll(async () => {
    db = await getDbService();
    audit = new AuditLogService(db);
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({
      where: { resolverName: 'processScan-1144-spec' },
    });
    await audit.onModuleDestroy();
  });

  it('persists a processScan audit row with the image payload redacted', async () => {
    const row = await audit.logSync({
      serviceName: 'documents',
      operationType: 'mutation',
      resolverName: 'processScan-1144-spec',
      requestId: 'req-1144-spec',
      success: true,
      action: AuditAction.CREATE,
      entityType: 'document',
      // Exactly the shape the interceptor captures: raw GraphQL args.
      inputVariables: {
        input: {
          data: SENTINEL,
          mimeType: 'image/jpeg',
          scanLocation: 'CA',
        },
      },
    });

    // Read back what the DATABASE holds, not what the service returned.
    const persisted = await db.auditLog.findUniqueOrThrow({
      where: { id: row.id },
    });

    const serialized = JSON.stringify(persisted.inputVariables);
    expect(serialized).not.toContain('LEAKED_SCAN_PAYLOAD_1144');
    expect(serialized).toContain('[REDACTED]');
    // Parameter fields keep their diagnostic value — masking, not blanking.
    expect(serialized).toContain('image/jpeg');
  });
});
