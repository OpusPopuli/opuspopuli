-- Supabase Vault Functions for Opus Populi
--
-- This migration creates functions to read secrets from Supabase Vault
-- (powered by pgsodium extension).
--
-- Prerequisites:
--   - pgsodium extension must be enabled (enabled by default in Supabase)
--   - vault schema must exist (created by Supabase)
--
-- Usage:
--   1. Create secrets in Supabase Studio under Database > Vault
--   2. Access via RPC: supabase.rpc('vault_read_secret', { secret_name: 'my-secret' })

-- Function to read a single decrypted secret by name
CREATE OR REPLACE FUNCTION public.vault_read_secret(secret_name text)
RETURNS TABLE (decrypted_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
BEGIN
  -- Check if the vault schema and decrypted_secrets view exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'vault'
  ) THEN
    RAISE EXCEPTION 'Vault schema does not exist. Please enable Supabase Vault.';
  END IF;

  RETURN QUERY
  SELECT d.decrypted_secret
  FROM vault.decrypted_secrets d
  WHERE d.name = secret_name;
END;
$$;

-- Grant execute permission to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.vault_read_secret(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_read_secret(text) TO service_role;

-- Optional: Function to list all secret names (not values) for debugging
CREATE OR REPLACE FUNCTION public.vault_list_secrets()
RETURNS TABLE (id uuid, name text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.created_at
  FROM vault.secrets s
  ORDER BY s.name;
END;
$$;

-- Only service_role can list secrets
GRANT EXECUTE ON FUNCTION public.vault_list_secrets() TO service_role;

-- Comment on functions
COMMENT ON FUNCTION public.vault_read_secret(text) IS 'Read a decrypted secret from Supabase Vault by name';
COMMENT ON FUNCTION public.vault_list_secrets() IS 'List all secret names in Supabase Vault (service_role only)';
