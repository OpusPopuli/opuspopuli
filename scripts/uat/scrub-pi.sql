-- Scrub personal information from a production dump restored into UAT.
--
-- Run AFTER pg_restore, BEFORE anyone uses the environment. Idempotent.
-- Wrapped in a single transaction: a failure anywhere leaves the database
-- untouched rather than half-scrubbed, which is the dangerous state.
--
-- WHY THE SHAPE OF THIS FILE
-- The first version of this script was derived from `schema.prisma` and was
-- wrong in three ways that only showed up against real data:
--   * Prisma field names are not column names (`addressLine1` is
--     `address_line_1`), so it failed on the first UPDATE.
--   * Nulling `latitude`/`longitude` left `point`, a PostGIS geometry holding
--     the same coordinates. The scrub would have "succeeded" while preserving
--     exact household locations.
--   * It never looked for tables it did not already know about, so it missed
--     `documents` (OCR'd petition sheets, containing third parties' names and
--     signatures) and six caches of LLM text written about a specific person.
--
-- So: column lists come from the live database, and Section 0 FAILS CLOSED.
-- A migration that adds a column to a masked table aborts this script instead
-- of quietly leaking the new field.
--
-- DELIBERATELY NOT SCRUBBED — these look personal and are public record:
--   contributions.donor_city / donor_zip  (CAL-ACCESS publishes them; the
--     campaign-finance data is unusable without them)
--   representatives.last_name / bio / photo_url  (elected officials)

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Fail closed. Every column of every masked table must be accounted for
--    below, as either scrubbed or deliberately kept.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  known jsonb := jsonb_build_object(
    'users', ARRAY[
      'id','email','first_name','last_name',           -- scrubbed
      'auth_strategy','created','updated','deleted_at',
      'commitments_acknowledged_at','commitments_version_acknowledged'],
    'user_logins', ARRAY[
      'password_hash',                                  -- scrubbed
      'id','user_id','last_login_at','login_count',
      'failed_login_attempts','locked_until','created_at','updated_at'],
    'user_profiles', ARRAY[
      'first_name','middle_name','last_name','display_name','preferred_name',
      'date_of_birth','phone','phone_verified_at','avatar_url','bio',
      'avatar_storage_key','political_affiliation','voting_frequency',
      'policy_priorities','occupation','education_level','income_range',
      'household_size','homeowner_status',              -- scrubbed
      'id','user_id','timezone','locale','preferred_language','is_public',
      'created_at','updated_at','onboarding_completed_at'],
    'user_addresses', ARRAY[
      'address_line_1','address_line_2','city','postal_code','latitude',
      'longitude','formatted_address','place_id','point','label',
      'polling_place','precinct_id','civic_resolution_error',
      'verification_method','verified_at',              -- scrubbed
      'id','user_id','address_type','is_primary','state','country',
      'county','municipality','school_district','congressional_district',
      'state_senatorial_district','state_assembly_district','geocoded_at',
      'civic_data_updated_at','is_verified','created_at','updated_at',
      'civic_resolution_status'],
    'signal_profiles', ARRAY[
      'political_self_id','faith_community','union_affiliation',
      'trusted_organizations','conviction_strength','accessibility_needs',
      'children_age_bands','aging_parents_state','has_eldercare_dependents',
      'partner_status','industry','occupation_category','employer_size_band',
      'special_licenses','housing_flags','tax_exposure','multigenerational',
      'has_pets','reading_level',                       -- scrubbed
      'id','user_id','housing_tenure','building_type','employment_status',
      'union_member','gig_worker','tipped_worker','primary_transit_mode',
      'vehicle_types','commute_band','transit_pass_holder','bike_share_member',
      'student_level','parent_of_student','educator','interest_tags',
      'weekly_attention_minutes','preferred_depth','created_at','updated_at']
  );
  tbl text; unknown text[];
BEGIN
  FOR tbl IN SELECT jsonb_object_keys(known) LOOP
    SELECT array_agg(c.column_name) INTO unknown
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = tbl
       AND NOT (c.column_name = ANY (
             SELECT jsonb_array_elements_text(known -> tbl)));
    IF unknown IS NOT NULL THEN
      RAISE EXCEPTION
        'scrub-pi: table % has unclassified column(s): %. Classify them as '
        'scrubbed or kept before running against production data.',
        tbl, array_to_string(unknown, ', ');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TRUNCATE what has no debugging value. Deleting cannot be done wrong.
-- ---------------------------------------------------------------------------

-- Live credentials: a restored dump otherwise holds session and refresh
-- tokens valid against production accounts.
TRUNCATE TABLE user_sessions, webauthn_challenges, passkey_credentials;

-- Mail users sent to their representatives: recipients, subjects, bodies.
TRUNCATE TABLE email_correspondence;

-- Attribution is the audit log's whole purpose; a masked one is not an audit
-- log. Same for the append-only behavioural history of what each person read.
TRUNCATE TABLE audit_logs, user_events;

-- Consent records are legally meaningful for the accounts they belong to, and
-- carry ip_address + user_agent. A copy in UAT can only mislead.
TRUNCATE TABLE user_consents;

-- Veteran status, encrypted at rest. UAT shares the region pgsodium key, so
-- the ciphertext is readable here. Onboarding promises this is never shown
-- publicly and never used to target anyone.
TRUNCATE TABLE sensitive_profiles;

-- Scanned petition sheets: `extracted_text` is OCR of a physical page, so it
-- contains the names, addresses and signatures of THIRD PARTIES who never had
-- an account here and never consented to anything. The most sensitive data in
-- the database, and it has no bearing on county thresholds.
-- Truncated together with its two foreign-key dependents rather than with
-- CASCADE: naming them is a decision, CASCADE is whatever the schema happens
-- to reference today. `abuse_reports` needs to go on its own merits anyway:
-- reporter_id plus a free-text description of what someone reported.
TRUNCATE TABLE documents, abuse_reports, document_propositions;

-- LLM text written about one identified person, inferred from their signal
-- profile. Regenerating it in UAT is cheap; copying inferences about real
-- people is not.
TRUNCATE TABLE bill_relevance_cache, committee_relevance_cache,
               proposition_relevance_cache, representative_relevance_cache,
               briefing_summary_cache, personalized_impact_cache,
               llm_rerank_jobs;

-- ---------------------------------------------------------------------------
-- 2. MASK where referential shape matters. Row counts and foreign keys
--    survive; the people do not.
-- ---------------------------------------------------------------------------

UPDATE users SET
  email      = 'user-' || id || '@example.invalid',
  first_name = 'Test',
  last_name  = 'User-' || left(id, 8);

UPDATE user_logins SET password_hash = NULL;

UPDATE user_profiles SET
  first_name = 'Test', middle_name = NULL,
  last_name  = 'User-' || left(user_id, 8),
  display_name = 'Test User', preferred_name = NULL,
  date_of_birth = NULL, phone = NULL, phone_verified_at = NULL,
  avatar_url = NULL, avatar_storage_key = NULL, bio = NULL,
  -- Political affiliation, voting frequency and policy priorities are the
  -- product's own subject matter. They must not exist in a debugging copy.
  political_affiliation = NULL, voting_frequency = NULL,
  policy_priorities = '{}',
  occupation = NULL, education_level = NULL, income_range = NULL,
  household_size = NULL, homeowner_status = NULL;

-- County and the district columns stay: jurisdiction resolution is the entire
-- reason this data is in UAT. Everything identifying a household goes,
-- including `point`, which carries the same coordinates as lat/long and would
-- otherwise survive nulling them.
UPDATE user_addresses SET
  address_line_1 = '1 Test Street', address_line_2 = NULL,
  city = 'Santa Rosa', postal_code = '95404',
  latitude = NULL, longitude = NULL, point = NULL,
  formatted_address = NULL, place_id = NULL, label = NULL,
  polling_place = NULL, precinct_id = NULL,
  civic_resolution_error = NULL,
  verification_method = NULL, verified_at = NULL;

-- Not "topics": political self-identification, faith community, union
-- affiliation, disability needs and children's age bands are special-category
-- data. interest_tags stays, because bill ranking is worth debugging.
UPDATE signal_profiles SET
  political_self_id = NULL, faith_community = NULL, union_affiliation = NULL,
  trusted_organizations = '{}', conviction_strength = NULL,
  accessibility_needs = '{}', children_age_bands = '{}',
  aging_parents_state = NULL, has_eldercare_dependents = NULL,
  partner_status = NULL, industry = NULL, occupation_category = NULL,
  employer_size_band = NULL, special_licenses = '{}',
  housing_flags = '{}', tax_exposure = '{}',
  multigenerational = NULL, has_pets = NULL, reading_level = NULL;

-- ---------------------------------------------------------------------------
-- 3. The auth schema. GoTrue keeps its OWN copy of every account, and it is
--    the copy that holds the password hash.
--
--    Built column-by-column from information_schema rather than as one fixed
--    UPDATE: GoTrue's schema varies by version, and this node runs an older
--    one with no `phone`, `identities` or `sessions`. A fixed statement fails
--    on the first missing column and takes the whole scrub with it, which is
--    how a half-configured environment ends up with real emails in it.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
  -- column -> replacement expression. Applied only where the column exists.
  subs text[][] := ARRAY[
    ['email',               $$'user-' || id || '@example.invalid'$$],
    ['encrypted_password',  'NULL'],
    ['phone',               'NULL'],
    ['phone_confirmed_at',  'NULL'],
    -- Live account-takeover vectors: these tokens confirm an address, reset a
    -- password, or complete an email change.
    ['confirmation_token',  $$''$$],
    ['recovery_token',      $$''$$],
    ['email_change_token',  $$''$$],
    -- Holds the pending NEW address during an email change.
    ['email_change',        $$''$$],
    ['raw_user_meta_data',  $$'{}'::jsonb$$],
    ['raw_app_meta_data',   $$'{}'::jsonb$$],
    ['identity_data',       $$'{}'::jsonb$$]
  ];
  sets text[] := '{}';
  i int;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    FOR i IN 1 .. array_length(subs, 1) LOOP
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='auth' AND table_name='users'
                    AND column_name = subs[i][1]) THEN
        sets := sets || format('%I = %s', subs[i][1], subs[i][2]);
      END IF;
    END LOOP;
    IF array_length(sets, 1) > 0 THEN
      EXECUTE format('UPDATE auth.users SET %s', array_to_string(sets, ', '));
    END IF;
  END IF;

  -- Provider identities embed the email a second time inside identity_data.
  IF to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $sql$UPDATE auth.identities
                 SET identity_data = jsonb_build_object('sub', user_id::text)$sql$;
  END IF;

  -- Sessions, refresh tokens, MFA factors, one-time tokens, GoTrue's own
  -- per-login IP audit trail, and in-flight auth flows. Each guarded, since
  -- which of these exist depends on the GoTrue version.
  FOR i IN 1 .. 6 LOOP
    DECLARE
      t text := (ARRAY['auth.sessions','auth.refresh_tokens','auth.mfa_factors',
                       'auth.one_time_tokens','auth.audit_log_entries',
                       'auth.flow_state'])[i];
    BEGIN
      IF to_regclass(t) IS NOT NULL THEN
        EXECUTE format('TRUNCATE %s CASCADE', t);
      END IF;
    END;
  END LOOP;
END $do$;

COMMIT;
