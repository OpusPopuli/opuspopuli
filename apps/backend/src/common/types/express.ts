import { UserInfo } from '../utils/graphql-context';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Extend Express.User to include our UserInfo properties
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserInfo {}

    // Extend Express.Request to include audit context for request tracing
    interface Request {
      auditContext?: {
        requestId: string;
        ipAddress?: string;
        userAgent?: string;
        startTime: number;
      };
    }
  }
}
