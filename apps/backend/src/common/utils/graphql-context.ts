import { UserInputError } from '@nestjs/apollo';

/**
 * User information extracted from the authenticated context
 */
export interface UserInfo {
  id: string;
  email: string;
}

/**
 * GraphQL context interface representing the request context
 */
export interface GqlContext {
  req: {
    user?: UserInfo;
  };
}

/**
 * Extracts authenticated user information from GraphQL context.
 * The user is set on req.user by the auth middleware after JWT validation.
 *
 * @throws UserInputError if user is not authenticated
 */
export function getUserFromContext(context: GqlContext): UserInfo {
  const user = context.req.user;
  if (!user) {
    throw new UserInputError('User not authenticated');
  }
  return user;
}
