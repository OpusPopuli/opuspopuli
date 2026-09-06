-- Verify that `scrub-pi.sql` actually removed what it claims to.
--
-- The danger with a scrub is not that it fails loudly. It is that it succeeds
-- while missing a column and nobody finds out. This asserts the OUTCOME and
-- raises on any survivor, so it can gate a pipeline instead of being read by
-- eye. Exit non-zero means personal information is still present.
--
-- Every check here corresponds to something the scrub was actually observed
-- to miss at some point: `point` surviving after lat/long were nulled,
-- `political_affiliation` never being listed, `documents` not being known
-- about at all, GoTrue holding a second copy of every address.

DO $do$
DECLARE
  n bigint;
  failures text[] := '{}';
  t text;
  emptied text[] := ARRAY[
    'user_sessions', 'webauthn_challenges', 'passkey_credentials',
    'email_correspondence', 'audit_logs', 'user_events', 'user_consents',
    'sensitive_profiles', 'documents', 'abuse_reports',
    'document_propositions', 'bill_relevance_cache',
    'committee_relevance_cache', 'proposition_relevance_cache',
    'representative_relevance_cache', 'briefing_summary_cache',
    'personalized_impact_cache', 'llm_rerank_jobs'
  ];
BEGIN
  FOREACH t IN ARRAY emptied LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN
        failures := failures || format('%s still has %s rows', t, n);
      END IF;
    END IF;
  END LOOP;

  -- Addresses. `point` is the one that matters most: it is a PostGIS geometry
  -- carrying the same coordinates as latitude/longitude, so nulling those two
  -- and stopping there leaves exact household locations in place.
  SELECT count(*) INTO n FROM user_addresses
   WHERE address_line_1 IS DISTINCT FROM '1 Test Street'
      OR address_line_2 IS NOT NULL
      OR latitude IS NOT NULL OR longitude IS NOT NULL
      OR point IS NOT NULL
      OR formatted_address IS NOT NULL OR place_id IS NOT NULL
      OR label IS NOT NULL OR polling_place IS NOT NULL
      OR precinct_id IS NOT NULL OR civic_resolution_error IS NOT NULL;
  IF n > 0 THEN failures := failures || format('user_addresses: %s unmasked', n); END IF;

  SELECT count(*) INTO n FROM users WHERE email NOT LIKE '%@example.invalid';
  IF n > 0 THEN failures := failures || format('users: %s real emails', n); END IF;

  SELECT count(*) INTO n FROM user_logins WHERE password_hash IS NOT NULL;
  IF n > 0 THEN failures := failures || format('user_logins: %s password hashes', n); END IF;

  -- Profile, including the political columns that are the product's own
  -- subject matter and must never exist in a debugging copy.
  SELECT count(*) INTO n FROM user_profiles
   WHERE date_of_birth IS NOT NULL OR phone IS NOT NULL OR bio IS NOT NULL
      OR middle_name IS NOT NULL OR preferred_name IS NOT NULL
      OR avatar_url IS NOT NULL OR avatar_storage_key IS NOT NULL
      OR political_affiliation IS NOT NULL OR voting_frequency IS NOT NULL
      OR occupation IS NOT NULL OR education_level IS NOT NULL
      OR income_range IS NOT NULL OR household_size IS NOT NULL
      OR homeowner_status IS NOT NULL
      OR coalesce(array_length(policy_priorities, 1), 0) > 0;
  IF n > 0 THEN failures := failures || format('user_profiles: %s unmasked', n); END IF;

  -- Special-category signal fields.
  SELECT count(*) INTO n FROM signal_profiles
   WHERE political_self_id IS NOT NULL OR faith_community IS NOT NULL
      OR union_affiliation IS NOT NULL OR conviction_strength IS NOT NULL
      OR aging_parents_state IS NOT NULL OR partner_status IS NOT NULL
      OR industry IS NOT NULL OR occupation_category IS NOT NULL
      OR employer_size_band IS NOT NULL OR has_eldercare_dependents IS NOT NULL
      OR multigenerational IS NOT NULL OR has_pets IS NOT NULL
      OR reading_level IS NOT NULL
      OR coalesce(array_length(trusted_organizations, 1), 0) > 0
      OR coalesce(array_length(accessibility_needs, 1), 0) > 0
      OR coalesce(array_length(children_age_bands, 1), 0) > 0
      OR coalesce(array_length(special_licenses, 1), 0) > 0
      OR coalesce(array_length(housing_flags, 1), 0) > 0
      OR coalesce(array_length(tax_exposure, 1), 0) > 0;
  IF n > 0 THEN failures := failures || format('signal_profiles: %s special-category', n); END IF;

  -- GoTrue's second copy of every account. Column-guarded, because which of
  -- these exist depends on the GoTrue version.
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM auth.users
               WHERE email NOT LIKE '%@example.invalid'$q$ INTO n;
    IF n > 0 THEN failures := failures || format('auth.users: %s real emails', n); END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='auth' AND table_name='users'
                  AND column_name='encrypted_password') THEN
      EXECUTE 'SELECT count(*) FROM auth.users WHERE encrypted_password IS NOT NULL' INTO n;
      IF n > 0 THEN failures := failures || format('auth.users: %s password hashes', n); END IF;
    END IF;

    -- Account-takeover tokens, and the pending address of an email change.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='auth' AND table_name='users'
                  AND column_name='recovery_token') THEN
      EXECUTE $q$SELECT count(*) FROM auth.users
                 WHERE coalesce(recovery_token,'') <> ''
                    OR coalesce(confirmation_token,'') <> ''
                    OR coalesce(email_change,'') <> ''$q$ INTO n;
      IF n > 0 THEN failures := failures || format('auth.users: %s live tokens', n); END IF;
    END IF;
  END IF;

  FOREACH t IN ARRAY ARRAY['auth.sessions','auth.refresh_tokens',
                           'auth.audit_log_entries','auth.one_time_tokens'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', t) INTO n;
      IF n > 0 THEN failures := failures || format('%s: %s rows', t, n); END IF;
    END IF;
  END LOOP;

  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION E'PI SURVIVED THE SCRUB:\n  %', array_to_string(failures, E'\n  ');
  END IF;

  RAISE NOTICE 'scrub verified: no personal information found';
END $do$;
