-- Personalization signal layer for the AI-powered personalized bill feed
-- (epic OpusPopuli/opuspopuli#740, this issue #742 — slice A).
--
-- Three new tables backing the 16-category signal taxonomy from
-- docs/architecture/personalized-relevance.md:
--
--   signal_profiles    — T1 + T2 declared signals (1:1 with users)
--   sensitive_profiles — T3 sensitive signals in a single encrypted blob
--   user_events        — append-only behavioral event log (§4.12)
--
-- Additive only. All sensitive fields stored as a single AES-256-GCM
-- ciphertext rather than per-field columns so the schema doesn't leak the
-- field list and so per-field encryption complexity is avoided. The
-- relevance engine in `knowledge` consumes only boolean-flag derivations
-- resolved at the federation boundary — never the raw values.

-- ============================================================
-- signal_profiles — T1 + T2 personalization signals
-- ============================================================
CREATE TABLE "signal_profiles" (
  "id"                       TEXT          NOT NULL,
  "user_id"                  TEXT          NOT NULL,

  -- §4.2 Housing
  "housing_tenure"           VARCHAR(50),
  "building_type"            VARCHAR(50),
  "tax_exposure"             TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "housing_flags"            TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- §4.3 Household
  "children_age_bands"       TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "has_eldercare_dependents" BOOLEAN,
  "multigenerational"        BOOLEAN,
  "has_pets"                 BOOLEAN,
  "partner_status"           VARCHAR(50),

  -- §4.4 Work (income band lives in sensitive_profiles)
  "employment_status"        VARCHAR(50),
  "industry"                 VARCHAR(100),
  "occupation_category"      VARCHAR(100),
  "employer_size_band"       VARCHAR(50),
  "union_member"             BOOLEAN,
  "gig_worker"               BOOLEAN,
  "tipped_worker"            BOOLEAN,

  -- §4.6 Transportation
  "primary_transit_mode"     VARCHAR(50),
  "vehicle_types"            TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "commute_band"             VARCHAR(30),
  "special_licenses"         TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "transit_pass_holder"      BOOLEAN,
  "bike_share_member"        BOOLEAN,

  -- §4.7 Education
  "student_level"            VARCHAR(30),
  "parent_of_student"        TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "educator"                 BOOLEAN,

  -- §4.10 Declared values
  "interest_tags"            TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "conviction_strength"      JSONB,
  "political_self_id"        VARCHAR(100),

  -- §4.11 Affiliations
  "trusted_organizations"    TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "union_affiliation"        VARCHAR(255),
  "faith_community"          VARCHAR(255),

  -- §4.13 Attention & format
  "weekly_attention_minutes" INTEGER,
  "preferred_depth"          VARCHAR(30),
  "accessibility_needs"      TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reading_level"            VARCHAR(30),

  -- §4.14 Relational graph (minimal subset)
  "aging_parents_state"      VARCHAR(2),

  "created_at"               TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "signal_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signal_profiles_user_id_key"
  ON "signal_profiles"("user_id");

ALTER TABLE "signal_profiles"
  ADD CONSTRAINT "signal_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- sensitive_profiles — T3 signals in a single encrypted blob
-- ============================================================
-- The encrypted payload contains the JSON-serialized SensitiveProfilePayload
-- shape (insuranceType, citizenshipStatus, raceEthnicity[], etc. — see
-- the doc's §4.5/4.8/4.9 categories). Encryption is AES-256-GCM at the
-- application layer with a key managed via env var / Supabase Vault.
--
-- no_fields_mode is the master toggle from doc §9.2. When true, the
-- service returns null for all sensitive reads and writes are no-ops
-- regardless of stored payload — supporting high-risk users.
CREATE TABLE "sensitive_profiles" (
  "id"                  TEXT        NOT NULL,
  "user_id"             TEXT        NOT NULL,
  "encrypted_payload"   BYTEA,
  "encryption_iv"       BYTEA,
  "encryption_auth_tag" BYTEA,
  "key_version"         INTEGER     NOT NULL DEFAULT 1,
  "no_fields_mode"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sensitive_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sensitive_profiles_user_id_key"
  ON "sensitive_profiles"("user_id");

ALTER TABLE "sensitive_profiles"
  ADD CONSTRAINT "sensitive_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- user_events — append-only behavioral log (§4.12)
-- ============================================================
-- objectId references foreign-service primary keys (bills, propositions,
-- representatives) and intentionally has no FK constraint since those
-- entities live in other microservices per the bounded-context rule.
CREATE TABLE "user_events" (
  "id"          TEXT        NOT NULL,
  "user_id"     TEXT        NOT NULL,
  "verb"        VARCHAR(30) NOT NULL,
  "object_type" VARCHAR(30) NOT NULL,
  "object_id"   TEXT        NOT NULL,
  "context"     JSONB,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_events_user_id_occurred_at_idx"
  ON "user_events"("user_id", "occurred_at" DESC);
CREATE INDEX "user_events_user_id_object_type_occurred_at_idx"
  ON "user_events"("user_id", "object_type", "occurred_at" DESC);

ALTER TABLE "user_events"
  ADD CONSTRAINT "user_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
