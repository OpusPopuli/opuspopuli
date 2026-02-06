import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to mark a route or resolver as publicly accessible.
 *
 * When applied to a controller method or resolver, the AuthGuard will
 * allow unauthenticated access.
 *
 * SECURITY: Use sparingly. Only mark endpoints as public when they truly
 * need to be accessible without authentication (e.g., login, register, health checks).
 *
 * @example
 * ```typescript
 * @Public()
 * @Mutation(() => AuthResponse)
 * async login(@Args('input') input: LoginInput) {
 *   return this.authService.login(input);
 * }
 * ```
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/183
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
