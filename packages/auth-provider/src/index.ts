/**
 * @opuspopuli/auth-provider
 *
 * Authentication provider implementations for the QCKSTRT platform.
 * Provides pluggable authentication with Supabase Auth.
 */

// Re-export types from common
export {
  IAuthProvider,
  IAuthConfig,
  IAuthResult,
  IRegisterUserInput,
  AuthError,
} from "@opuspopuli/common";

// Providers
export { SupabaseAuthProvider } from "./providers/supabase.provider.js";

// Module
export { AuthModule } from "./auth.module.js";
