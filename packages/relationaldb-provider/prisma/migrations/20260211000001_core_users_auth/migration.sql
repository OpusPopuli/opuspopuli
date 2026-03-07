-- Enable pg_trgm extension for trigram-based ILIKE indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "AuthStrategy" AS ENUM ('password', 'magic_link', 'passkey');

-- CreateEnum
CREATE TYPE "PoliticalAffiliation" AS ENUM ('democrat', 'republican', 'independent', 'libertarian', 'green', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "VotingFrequency" AS ENUM ('every_election', 'most_elections', 'some_elections', 'rarely', 'never', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('high_school', 'some_college', 'associate', 'bachelor', 'master', 'doctorate', 'trade_school', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "IncomeRange" AS ENUM ('under_25k', '25k_50k', '50k_75k', '75k_100k', '100k_150k', '150k_200k', 'over_200k', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "HomeownerStatus" AS ENUM ('own', 'rent', 'living_with_family', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('terms_of_service', 'privacy_policy', 'marketing_email', 'marketing_sms', 'marketing_push', 'data_sharing', 'analytics', 'personalization', 'location_tracking', 'voter_data_collection', 'civic_notifications', 'representative_contact');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('granted', 'denied', 'withdrawn', 'pending');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('residential', 'mailing', 'business', 'voting');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "auth_strategy" VARCHAR(20),
    "created" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" VARCHAR(255),
    "middle_name" VARCHAR(255),
    "last_name" VARCHAR(255),
    "display_name" VARCHAR(255),
    "preferred_name" VARCHAR(255),
    "date_of_birth" DATE,
    "phone" VARCHAR(20),
    "phone_verified_at" TIMESTAMPTZ,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/Los_Angeles',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "preferred_language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "avatar_url" VARCHAR(500),
    "bio" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "avatar_storage_key" VARCHAR(255),
    "political_affiliation" "PoliticalAffiliation",
    "voting_frequency" "VotingFrequency",
    "policy_priorities" TEXT[],
    "occupation" VARCHAR(100),
    "education_level" "EducationLevel",
    "income_range" "IncomeRange",
    "household_size" VARCHAR(50),
    "homeowner_status" "HomeownerStatus",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_logins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password_hash" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ,
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "aaguid" VARCHAR(36),
    "device_type" VARCHAR(50),
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "friendly_name" VARCHAR(255),
    "transports" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "identifier" VARCHAR(255) NOT NULL,
    "challenge" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("identifier")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_token" VARCHAR(255) NOT NULL,
    "refresh_token" VARCHAR(255),
    "device_type" VARCHAR(100),
    "device_name" VARCHAR(255),
    "browser" VARCHAR(255),
    "operating_system" VARCHAR(100),
    "ip_address" INET,
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "country" VARCHAR(2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_activity_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "document_version" VARCHAR(50),
    "document_url" VARCHAR(255),
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "collection_method" VARCHAR(100),
    "collection_context" VARCHAR(255),
    "granted_at" TIMESTAMPTZ,
    "denied_at" TIMESTAMPTZ,
    "withdrawn_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "consent_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address_type" "AddressType" NOT NULL DEFAULT 'residential',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(255),
    "address_line_1" VARCHAR(255) NOT NULL,
    "address_line_2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(20) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'US',
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "formatted_address" VARCHAR(255),
    "place_id" VARCHAR(100),
    "geocoded_at" TIMESTAMPTZ,
    "congressional_district" VARCHAR(50),
    "state_senatorial_district" VARCHAR(50),
    "state_assembly_district" VARCHAR(50),
    "county" VARCHAR(100),
    "municipality" VARCHAR(100),
    "school_district" VARCHAR(100),
    "precinct_id" VARCHAR(100),
    "polling_place" VARCHAR(100),
    "civic_data_updated_at" TIMESTAMPTZ,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verification_method" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_logins_user_id_key" ON "user_logins"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_logins_failed_attempts" ON "user_logins"("failed_login_attempts");

-- CreateIndex
CREATE INDEX "idx_user_logins_locked_until" ON "user_logins"("locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "passkey_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "passkey_credentials_user_id_idx" ON "passkey_credentials"("user_id");

-- CreateIndex
CREATE INDEX "idx_webauthn_challenges_lookup" ON "webauthn_challenges"("identifier", "type");

-- CreateIndex
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_key" ON "user_sessions"("session_token");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_is_active_idx" ON "user_sessions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");

-- CreateIndex
CREATE INDEX "user_consents_user_id_status_idx" ON "user_consents"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_consent_type_key" ON "user_consents"("user_id", "consent_type");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses"("user_id");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_address_type_idx" ON "user_addresses"("user_id", "address_type");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_is_primary_idx" ON "user_addresses"("user_id", "is_primary");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_logins" ADD CONSTRAINT "user_logins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
