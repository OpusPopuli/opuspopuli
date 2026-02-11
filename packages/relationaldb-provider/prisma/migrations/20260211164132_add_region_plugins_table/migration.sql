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

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('welcome', 'representative_contact', 'civic_update', 'election_reminder', 'ballot_update', 'account_activity');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'bounced');

-- CreateEnum
CREATE TYPE "NotificationFrequency" AS ENUM ('immediate', 'daily_digest', 'weekly_digest', 'never');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Processing', 'Text Extraction Started', 'Text Extraction Complete', 'Text Extraction Failed', 'AI Embeddings Started', 'AI Embeddings Complete', 'AI Embeddings Failed', 'AI Analysis Started', 'AI Analysis Complete', 'AI Analysis Failed', 'Complete');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('generic', 'petition', 'proposition', 'contract', 'form');

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

-- CreateTable
CREATE TABLE "email_correspondence" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_type" "EmailType" NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'pending',
    "recipient_email" VARCHAR(255) NOT NULL,
    "recipient_name" VARCHAR(255),
    "subject" VARCHAR(500) NOT NULL,
    "body_preview" TEXT,
    "representative_id" TEXT,
    "representative_name" VARCHAR(255),
    "proposition_id" TEXT,
    "proposition_title" VARCHAR(500),
    "resend_id" VARCHAR(255),
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_product_updates" BOOLEAN NOT NULL DEFAULT true,
    "email_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "email_marketing" BOOLEAN NOT NULL DEFAULT false,
    "email_frequency" "NotificationFrequency" NOT NULL DEFAULT 'immediate',
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_product_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "push_marketing" BOOLEAN NOT NULL DEFAULT false,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "sms_marketing" BOOLEAN NOT NULL DEFAULT false,
    "civic_election_reminders" BOOLEAN NOT NULL DEFAULT true,
    "civic_voter_deadlines" BOOLEAN NOT NULL DEFAULT true,
    "civic_ballot_updates" BOOLEAN NOT NULL DEFAULT true,
    "civic_local_news" BOOLEAN NOT NULL DEFAULT true,
    "civic_representative_updates" BOOLEAN NOT NULL DEFAULT true,
    "civic_frequency" "NotificationFrequency" NOT NULL DEFAULT 'daily_digest',
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" TIME,
    "quiet_hours_end" TIME,
    "unsubscribed_all_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" VARCHAR(255),
    "user_id" TEXT,
    "user_email" VARCHAR(255),
    "request_id" TEXT NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "operation_name" VARCHAR(100),
    "operation_type" VARCHAR(20),
    "resolver_name" VARCHAR(100),
    "input_variables" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "status_code" INTEGER,
    "error_message" TEXT,
    "previous_values" JSONB,
    "new_values" JSONB,
    "duration_ms" INTEGER,
    "service_name" VARCHAR(50) NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" VARCHAR(255) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Processing',
    "type" "DocumentType" NOT NULL DEFAULT 'generic',
    "extracted_text" TEXT,
    "content_hash" VARCHAR(64),
    "ocr_confidence" DOUBLE PRECISION,
    "ocr_provider" VARCHAR(50),
    "analysis" JSONB,
    "embedding" vector(1536),
    "scan_location" geography(Point, 4326),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representatives" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "photo_url" TEXT,
    "contact_info" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propositions" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "full_text" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "election_date" TIMESTAMP,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "propositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP NOT NULL,
    "location" TEXT,
    "agenda_url" TEXT,
    "video_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region_plugins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "package_name" TEXT NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "last_sync_at" TIMESTAMPTZ,
    "last_sync_status" VARCHAR(50),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "region_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "users"("email");

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
CREATE INDEX "passkey_credentials_credential_id_idx" ON "passkey_credentials"("credential_id");

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

-- CreateIndex
CREATE INDEX "email_correspondence_user_id_idx" ON "email_correspondence"("user_id");

-- CreateIndex
CREATE INDEX "email_correspondence_user_id_created_at_idx" ON "email_correspondence"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "email_correspondence_email_type_status_idx" ON "email_correspondence"("email_type", "status");

-- CreateIndex
CREATE INDEX "email_correspondence_representative_id_idx" ON "email_correspondence"("representative_id");

-- CreateIndex
CREATE INDEX "email_correspondence_proposition_id_idx" ON "email_correspondence"("proposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs"("user_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "documents_user_id_idx" ON "documents"("user_id");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "documents_content_hash_idx" ON "documents"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "representatives_external_id_key" ON "representatives"("external_id");

-- CreateIndex
CREATE INDEX "representatives_external_id_idx" ON "representatives"("external_id");

-- CreateIndex
CREATE INDEX "representatives_name_idx" ON "representatives"("name");

-- CreateIndex
CREATE INDEX "representatives_chamber_idx" ON "representatives"("chamber");

-- CreateIndex
CREATE INDEX "representatives_party_idx" ON "representatives"("party");

-- CreateIndex
CREATE UNIQUE INDEX "propositions_external_id_key" ON "propositions"("external_id");

-- CreateIndex
CREATE INDEX "propositions_external_id_idx" ON "propositions"("external_id");

-- CreateIndex
CREATE INDEX "propositions_status_idx" ON "propositions"("status");

-- CreateIndex
CREATE INDEX "propositions_election_date_idx" ON "propositions"("election_date");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_external_id_key" ON "meetings"("external_id");

-- CreateIndex
CREATE INDEX "meetings_external_id_idx" ON "meetings"("external_id");

-- CreateIndex
CREATE INDEX "meetings_body_idx" ON "meetings"("body");

-- CreateIndex
CREATE INDEX "meetings_scheduled_at_idx" ON "meetings"("scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "region_plugins_name_key" ON "region_plugins"("name");

-- CreateIndex
CREATE INDEX "region_plugins_name_idx" ON "region_plugins"("name");

-- CreateIndex
CREATE INDEX "region_plugins_enabled_idx" ON "region_plugins"("enabled");

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

-- AddForeignKey
ALTER TABLE "email_correspondence" ADD CONSTRAINT "email_correspondence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
