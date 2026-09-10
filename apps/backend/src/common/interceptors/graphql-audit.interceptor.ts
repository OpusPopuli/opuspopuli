import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable, tap, catchError } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../services/audit-log.service';
import {
  AuditMetadata,
  AUDIT_METADATA_KEY,
} from '../decorators/audit.decorator';
import { AuditAction } from '../enums/audit-action.enum';
import { IAuditLogCreate } from '../interfaces/audit.interface';
import { Request } from 'express';

interface GraphQLInfo {
  fieldName: string;
  operation?: {
    operation: string;
    name?: {
      value: string;
    };
  };
  parentType?: {
    name: string;
  };
}

@Injectable()
export class GraphQLAuditInterceptor implements NestInterceptor {
  private readonly serviceName: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {
    this.serviceName =
      this.configService.get<string>('application') || 'unknown';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only handle GraphQL requests - skip HTTP/REST endpoints
    const contextType = context.getType<string>();
    if (contextType !== 'graphql') {
      return next.handle();
    }

    const gqlCtx = GqlExecutionContext.create(context);
    const info: GraphQLInfo = gqlCtx.getInfo();

    // Additional safety check - if no GraphQL info, skip auditing
    if (!info?.fieldName) {
      return next.handle();
    }

    const ctx = gqlCtx.getContext();
    const args = gqlCtx.getArgs();
    const request: Request | undefined = ctx.req;

    // Get audit metadata from decorator
    const auditMetadata = this.reflector.get<AuditMetadata>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    // Skip if explicitly marked
    if (auditMetadata?.skipAudit) {
      return next.handle();
    }

    const startTime = Date.now();

    // Extract user info from request
    let userId: string | undefined;
    let userEmail: string | undefined;

    try {
      const userHeader = request?.headers?.user;
      if (userHeader && userHeader !== 'undefined') {
        const userStr = Array.isArray(userHeader) ? userHeader[0] : userHeader;
        const user = JSON.parse(userStr);
        userId = user.id;
        userEmail = user.email;
      }
    } catch {
      // Ignore parse errors
    }

    // Generate or extract requestId
    const requestIdHeader = request?.headers?.['x-request-id'];
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ||
      crypto.randomUUID();

    // Build base audit context
    const operationType = info.operation?.operation as
      | 'query'
      | 'mutation'
      | 'subscription'
      | undefined;

    const auditContext: Partial<IAuditLogCreate> = {
      requestId,
      userId,
      userEmail,
      ipAddress: this.extractIpAddress(request),
      userAgent: this.extractUserAgent(request),
      serviceName: this.serviceName,
      operationName: info.operation?.name?.value,
      operationType,
      resolverName: info.fieldName,
      inputVariables: args,
    };

    // Determine action from metadata or infer from operation type
    const action = auditMetadata?.action || this.inferAction(info);
    const entityType = auditMetadata?.entityType || this.inferEntityType(info);
    const entityId = this.resolveEntityId(args, auditMetadata?.entityIdArg);

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startTime;

        this.auditLogService.log({
          ...auditContext,
          action,
          entityType,
          entityId,
          success: true,
          durationMs,
        } as IAuditLogCreate);
      }),
      catchError((error: Error) => {
        const durationMs = Date.now() - startTime;

        this.auditLogService.log({
          ...auditContext,
          action,
          entityType,
          entityId,
          success: false,
          errorMessage: error.message,
          durationMs,
        } as IAuditLogCreate);

        throw error;
      }),
    );
  }

  private extractIpAddress(request: Request | undefined): string | undefined {
    if (!request?.headers) return undefined;

    // Check various headers for real IP (behind proxy/load balancer)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips?.trim();
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    return request.ip || request.socket?.remoteAddress || undefined;
  }

  private extractUserAgent(request: Request | undefined): string | undefined {
    if (!request?.headers) return undefined;
    const ua = request.headers['user-agent'];
    return Array.isArray(ua) ? ua[0] : ua;
  }

  private static readonly MUTATION_ACTION_PATTERNS: [string[], AuditAction][] =
    [
      [['create', 'register'], AuditAction.CREATE],
      [['update', 'change'], AuditAction.UPDATE],
      [['delete', 'remove'], AuditAction.DELETE],
      [['login'], AuditAction.LOGIN],
      [['logout'], AuditAction.LOGOUT],
      [['upload', 'index'], AuditAction.UPLOAD],
    ];

  private static readonly QUERY_ACTION_PATTERNS: [string[], AuditAction][] = [
    [['search'], AuditAction.SEARCH],
    [['download'], AuditAction.DOWNLOAD],
    [['list', 'getall', 'find'], AuditAction.BULK_READ],
  ];

  private inferAction(info: GraphQLInfo): AuditAction {
    const operationType = info.operation?.operation;
    const fieldName = info.fieldName?.toLowerCase() || '';

    const patterns =
      operationType === 'mutation'
        ? GraphQLAuditInterceptor.MUTATION_ACTION_PATTERNS
        : GraphQLAuditInterceptor.QUERY_ACTION_PATTERNS;

    for (const [keywords, action] of patterns) {
      if (keywords.some((keyword) => fieldName.includes(keyword))) {
        return action;
      }
    }

    return operationType === 'mutation' ? AuditAction.UPDATE : AuditAction.READ;
  }

  private static readonly ENTITY_PATTERN =
    /(?:get|create|update|delete|find|list|search|index|upload|download)(\w+)/i;

  /**
   * Ordered list of id-bearing keys looked for inside an `input` object.
   *
   * Deliberately short and explicit. `documentId` leads because `documents`
   * is the service whose mutations all take input objects — and in an input
   * carrying several ids (`LinkDocumentToPropositionInput` has `documentId`
   * AND `propositionId`) the document is the subject being acted on.
   */
  private static readonly INPUT_ID_KEYS = [
    'id',
    'documentId',
    'scanId',
    'propositionId',
  ] as const;

  /**
   * Resolve the audited entity's id from resolver args (#1151).
   *
   * `args.id` alone left `entityId` null for every mutation using the
   * input-object convention — all of `documents` — so the
   * `(entityType, entityId)` index on `audit_logs` answered nothing for that
   * service. "Show me this document's audit history" was unanswerable for
   * exactly the records most likely to need it.
   *
   * An ordered list of KNOWN keys, deliberately not a deep search: guessing
   * an id out of an arbitrary object graph is how an audit row ends up
   * attributed to the WRONG entity, which is worse than a null.
   *
   * A create mutation legitimately has no id at interception time —
   * `processScan` mints the document it audits. Those still record null,
   * which is honest. Where the resolver knows the created id, prefer an
   * explicit @Audit over widening this list.
   */
  private resolveEntityId(
    args: Record<string, unknown>,
    entityIdArg: string | undefined,
  ): string | undefined {
    const input = args.input as Record<string, unknown> | undefined;
    const asId = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;

    // An explicit @Audit({ entityIdArg }) wins, at either level.
    if (entityIdArg) {
      return asId(args[entityIdArg]) ?? asId(input?.[entityIdArg]);
    }

    if (asId(args.id)) return asId(args.id);
    if (!input) return undefined;

    for (const key of GraphQLAuditInterceptor.INPUT_ID_KEYS) {
      const found = asId(input[key]);
      if (found) return found;
    }
    return undefined;
  }

  private inferEntityType(info: GraphQLInfo): string | undefined {
    const entityFromFieldName = this.extractEntityFromFieldName(
      info.fieldName || '',
    );
    if (entityFromFieldName) {
      return entityFromFieldName;
    }

    return this.extractEntityFromParentType(info.parentType?.name);
  }

  private extractEntityFromFieldName(fieldName: string): string | undefined {
    const match = GraphQLAuditInterceptor.ENTITY_PATTERN.exec(fieldName);
    if (!match) {
      return undefined;
    }

    return this.singularize(match[1]);
  }

  private extractEntityFromParentType(
    parentTypeName: string | undefined,
  ): string | undefined {
    const isValidParentType =
      parentTypeName &&
      parentTypeName !== 'Query' &&
      parentTypeName !== 'Mutation';

    return isValidParentType ? parentTypeName : undefined;
  }

  private singularize(word: string): string {
    const shouldSingularize =
      word.length > 1 && word.endsWith('s') && !word.endsWith('ss');

    return shouldSingularize ? word.slice(0, -1) : word;
  }
}
