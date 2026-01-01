import { UserInfo } from '../utils/graphql-context';

declare global {
  namespace Express {
    // Extend Express.User to include our UserInfo properties
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserInfo {}
  }
}
