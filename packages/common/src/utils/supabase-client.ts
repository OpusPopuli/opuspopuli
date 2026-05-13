/**
 * Shared Supabase client factory used by multiple provider packages
 * (storage-provider, secrets-provider) to eliminate the identical
 * constructor init block (url/key resolution + createClient call).
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues (jscpd clone fix)
 */

/**
 * Options for resolving a Supabase client from NestJS ConfigService-style values.
 */
export interface SupabaseClientOptions {
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
  anonKey: string | undefined;
}

/**
 * Resolve the effective Supabase key (service role preferred, anon as fallback).
 * Throws if neither URL nor at least one key is provided.
 */
export function resolveSupabaseKey(opts: SupabaseClientOptions): {
  url: string;
  key: string;
} {
  const { supabaseUrl, serviceRoleKey, anonKey } = opts;

  if (!supabaseUrl || (!serviceRoleKey && !anonKey)) {
    throw new Error(
      "Supabase URL and key are required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)",
    );
  }

  return {
    url: supabaseUrl,
    key: (serviceRoleKey || anonKey)!,
  };
}

/**
 * Initialize a Supabase client from a config getter function.
 * Returns the resolved URL and the configured client so callers can log the URL.
 * Throws a plain Error if the config is incomplete; callers should re-throw as
 * their package-specific error class.
 *
 * This shared factory eliminates the identical constructor block across
 * SupabaseStorageProvider and SupabaseVaultProvider.
 *
 * @param getConfig - function that returns a value by key (e.g. configService.get)
 * @param createClientFn - the `createClient` function from @supabase/supabase-js
 */
export function initSupabaseFromConfig<TClient>(
  getConfig: (key: string) => string | undefined,
  createClientFn: (url: string, key: string, options: object) => TClient,
): { supabase: TClient; url: string } {
  const { url, key } = resolveSupabaseKey({
    supabaseUrl: getConfig("supabase.url"),
    serviceRoleKey: getConfig("supabase.serviceRoleKey"),
    anonKey: getConfig("supabase.anonKey"),
  });
  const supabase = createClientFn(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { supabase, url };
}
