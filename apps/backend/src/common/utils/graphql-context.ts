import { UserInputError } from '@nestjs/apollo';

/**
 * GraphQL context interface representing the request context
 */
export interface GqlContext {
  req: {
    headers: {
      user?: string;
    };
  };
}

/**
 * User information extracted from the authenticated context
 */
export interface UserInfo {
  id: string;
  email: string;
}

/**
 * Extracts authenticated user information from GraphQL context.
 * The user header is set by the auth middleware after JWT validation.
 *
 * @throws UserInputError if user is not authenticated
 */
export function getUserFromContext(context: GqlContext): UserInfo {
  const userHeader = context.req.headers.user;
  if (!userHeader) {
    throw new UserInputError('User not authenticated');
  }
  return JSON.parse(userHeader) as UserInfo;
}
