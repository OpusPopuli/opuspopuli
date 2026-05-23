-- Baseline migration: full schema as of 2026-05-22
-- Squashes 24 prior migrations (20260211000001 through 20260522010000).
-- Source of truth is schema.prisma; two constructs below cannot be expressed
-- in Prisma schema syntax and are added manually:
--   - pg_trgm extension (trigram ILIKE indexes)
--   - pipeline_executions partial unique index + status CHECK constraint

-- Extensions
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

-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('structural_analysis', 'document_analysis', 'rag');

-- CreateEnum
CREATE TYPE "AbuseReportReason" AS ENUM ('incorrect_analysis', 'offensive_content', 'wrong_document_type', 'privacy_concern', 'other');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('auto_analysis', 'user_manual');

-- CreateEnum
CREATE TYPE "CommitteeMeasurePositionType" AS ENUM ('support', 'oppose');

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('STATE', 'CONGRESSIONAL_DISTRICT', 'STATE_SENATE_DISTRICT', 'STATE_ASSEMBLY_DISTRICT', 'COUNTY', 'CITY', 'SCHOOL_DISTRICT_UNIFIED', 'SCHOOL_DISTRICT_ELEMENTARY', 'SCHOOL_DISTRICT_HIGH', 'COMMUNITY_COLLEGE_DISTRICT', 'WATER_DISTRICT', 'FIRE_DISTRICT', 'TRANSIT_DISTRICT', 'SPECIAL_DISTRICT', 'COUNTY_SUPERVISOR_DISTRICT');

-- CreateEnum
CREATE TYPE "JurisdictionLevel" AS ENUM ('FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'DISTRICT');

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
    "point" geography(Point, 4326),
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
CREATE TABLE "abuse_reports" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" "AbuseReportReason" NOT NULL,
    "description" TEXT,
    "status" "AbuseReportStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representatives" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "region_id" VARCHAR(100) NOT NULL DEFAULT 'california',
    "name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "chamber" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "party" TEXT,
    "photo_url" TEXT,
    "contact_info" JSONB,
    "committees" JSONB,
    "committees_summary" TEXT,
    "bio" TEXT,
    "bio_source" VARCHAR(20),
    "bio_claims" JSONB,
    "activity_summary" TEXT,
    "activity_summary_generated_at" TIMESTAMPTZ,
    "activity_summary_window_days" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legislative_committees" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chamber" VARCHAR(20) NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "activity_summary" TEXT,
    "activity_summary_generated_at" TIMESTAMPTZ,
    "activity_summary_window_days" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legislative_committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representative_committee_assignments" (
    "id" TEXT NOT NULL,
    "representative_id" TEXT NOT NULL,
    "legislative_committee_id" TEXT NOT NULL,
    "role" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "representative_committee_assignments_pkey" PRIMARY KEY ("id")
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
    "analysis_summary" TEXT,
    "key_provisions" JSONB,
    "fiscal_impact" TEXT,
    "yes_outcome" TEXT,
    "no_outcome" TEXT,
    "existing_vs_proposed" JSONB,
    "analysis_sections" JSONB,
    "analysis_claims" JSONB,
    "analysis_source" VARCHAR(20),
    "analysis_prompt_hash" VARCHAR(64),
    "analysis_generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "propositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minutes" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "body" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL,
    "revision_seq" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "committee_id" TEXT,
    "meeting_id" TEXT,
    "page_count" INTEGER,
    "source_url" TEXT NOT NULL,
    "raw_text" TEXT,
    "summary" TEXT,
    "summary_claims" JSONB,
    "parsed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legislative_actions" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "minutes_id" TEXT NOT NULL,
    "body" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL,
    "action_type" VARCHAR(40) NOT NULL,
    "representative_id" TEXT,
    "proposition_id" TEXT,
    "committee_id" TEXT,
    "position" VARCHAR(20),
    "text" TEXT,
    "summary" TEXT,
    "passage_start" INTEGER,
    "passage_end" INTEGER,
    "source_page" INTEGER,
    "raw_subject" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legislative_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_propositions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "proposition_id" TEXT NOT NULL,
    "link_source" "LinkSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "matched_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_propositions_pkey" PRIMARY KEY ("id")
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
    "minutes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "civics_blocks" (
    "id" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "chambers" JSONB,
    "measure_types" JSONB,
    "lifecycle_stages" JSONB,
    "session_scheme" JSONB,
    "glossary" JSONB,
    "prompt_hash" VARCHAR(64),
    "prompt_version" VARCHAR(20),
    "llm_model" VARCHAR(80),
    "extracted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "civics_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_entries" (
    "id" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "long_definition" JSONB,
    "related_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_url" TEXT NOT NULL,
    "prompt_hash" VARCHAR(64),
    "prompt_version" VARCHAR(20),
    "extracted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "glossary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "bill_number" VARCHAR(30) NOT NULL,
    "session_year" VARCHAR(10) NOT NULL,
    "measure_type_code" VARCHAR(10) NOT NULL,
    "title" TEXT NOT NULL,
    "subject" VARCHAR(500),
    "status" VARCHAR(200),
    "current_stage_id" VARCHAR(100),
    "last_action" TEXT,
    "last_action_date" DATE,
    "fiscal_impact" TEXT,
    "full_text_url" TEXT,
    "author_id" TEXT,
    "author_name" VARCHAR(200),
    "source_url" TEXT NOT NULL,
    "source_published_at" TIMESTAMPTZ,
    "extracted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_co_authors" (
    "bill_id" TEXT NOT NULL,
    "representative_id" TEXT NOT NULL,
    "co_author_type" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_co_authors_pkey" PRIMARY KEY ("bill_id","representative_id")
);

-- CreateTable
CREATE TABLE "bill_committee_assignments" (
    "bill_id" TEXT NOT NULL,
    "legislative_committee_id" TEXT NOT NULL,
    "referred_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_committee_assignments_pkey" PRIMARY KEY ("bill_id","legislative_committee_id")
);

-- CreateTable
CREATE TABLE "bill_votes" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "representative_id" TEXT,
    "representative_name" VARCHAR(200) NOT NULL,
    "chamber" VARCHAR(20) NOT NULL,
    "vote_date" DATE NOT NULL,
    "position" VARCHAR(20) NOT NULL,
    "motion_text" VARCHAR(200),
    "source_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region_plugins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "plugin_type" VARCHAR(20) NOT NULL DEFAULT 'declarative',
    "version" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "parent_region_id" VARCHAR(100),
    "fips_code" VARCHAR(10),
    "config" JSONB,
    "last_sync_at" TIMESTAMPTZ,
    "last_sync_status" VARCHAR(50),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "region_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "candidate_name" TEXT,
    "candidate_office" TEXT,
    "proposition_id" TEXT,
    "party" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "source_system" VARCHAR(20) NOT NULL,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_measure_positions" (
    "id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "proposition_id" TEXT NOT NULL,
    "position" "CommitteeMeasurePositionType" NOT NULL,
    "is_primary_formation" BOOLEAN NOT NULL DEFAULT false,
    "source_filing" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_measure_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cvr2_filings" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "filing_id" VARCHAR(50) NOT NULL,
    "ballot_name" TEXT,
    "ballot_number" VARCHAR(50),
    "ballot_jurisdiction" VARCHAR(100),
    "support_or_oppose" VARCHAR(10),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cvr2_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "donor_name" TEXT NOT NULL,
    "donor_type" VARCHAR(20) NOT NULL,
    "donor_employer" TEXT,
    "donor_occupation" TEXT,
    "donor_city" VARCHAR(100),
    "donor_state" VARCHAR(2),
    "donor_zip" VARCHAR(10),
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "election_type" VARCHAR(20),
    "contribution_type" VARCHAR(30),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenditures" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "payee_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "purpose_description" TEXT,
    "expenditure_code" VARCHAR(10),
    "candidate_name" TEXT,
    "proposition_title" TEXT,
    "proposition_id" TEXT,
    "support_or_oppose" VARCHAR(10),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenditures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "independent_expenditures" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "committee_name" TEXT NOT NULL,
    "candidate_name" TEXT,
    "proposition_title" TEXT,
    "proposition_id" TEXT,
    "support_or_oppose" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "election_date" DATE,
    "description" TEXT,
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "independent_expenditures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structural_manifests" (
    "id" TEXT NOT NULL,
    "region_id" VARCHAR(100) NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "data_type" VARCHAR(50) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "structure_hash" VARCHAR(64) NOT NULL,
    "prompt_hash" VARCHAR(64) NOT NULL,
    "extraction_rules" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "llm_provider" VARCHAR(50),
    "llm_model" VARCHAR(100),
    "llm_tokens_used" INTEGER,
    "analysis_time_ms" INTEGER,
    "last_used_at" TIMESTAMPTZ,
    "last_checked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "structural_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_executions" (
    "id" TEXT NOT NULL,
    "region_id" VARCHAR(100) NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "data_type" VARCHAR(50) NOT NULL,
    "manifest_id" TEXT,
    "manifest_version" INTEGER,
    "manifest_cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "structure_changed" BOOLEAN NOT NULL DEFAULT false,
    "self_heal_triggered" BOOLEAN NOT NULL DEFAULT false,
    "items_extracted" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,
    "analysis_time_ms" INTEGER,
    "extraction_time_ms" INTEGER NOT NULL DEFAULT 0,
    "total_time_ms" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'completed',
    "error_message" TEXT,
    "llm_provider" VARCHAR(50),
    "llm_model" VARCHAR(100),
    "llm_tokens_used" INTEGER,
    "executed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipeline_job_id" TEXT,

    CONSTRAINT "pipeline_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_execution_batches" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "batch_index" INTEGER NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_execution_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_jobs" (
    "id" TEXT NOT NULL,
    "bullmq_job_id" TEXT NOT NULL,
    "trigger_source" TEXT NOT NULL,
    "region_id" TEXT,
    "data_types" TEXT[],
    "depth" TEXT,
    "max_reps" INTEGER,
    "max_bills" INTEGER,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "enqueued_by" TEXT,
    "enqueued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "error_message" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structural_analysis_jobs" (
    "id" TEXT NOT NULL,
    "bullmq_job_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "region_id" VARCHAR(100) NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "data_type" VARCHAR(50) NOT NULL,
    "requested_by" VARCHAR(20) NOT NULL,
    "manifest_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "enqueued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "error_message" TEXT,

    CONSTRAINT "structural_analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_watermarks" (
    "id" TEXT NOT NULL,
    "region_id" VARCHAR(100) NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "data_type" VARCHAR(50) NOT NULL,
    "last_external_id" VARCHAR(255),
    "last_ingested_at" TIMESTAMPTZ,
    "items_ingested" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_watermarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" "PromptCategory" NOT NULL,
    "description" TEXT,
    "template_text" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" TEXT NOT NULL,
    "fips_code" VARCHAR(20),
    "ocd_id" VARCHAR(255),
    "name" VARCHAR(255) NOT NULL,
    "type" "JurisdictionType" NOT NULL,
    "level" "JurisdictionLevel" NOT NULL,
    "state_code" VARCHAR(2) NOT NULL,
    "parent_id" TEXT,
    "boundary" geography(MultiPolygon, 4326),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_jurisdictions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_address_id" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "resolved_by" VARCHAR(50) NOT NULL,
    "resolved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_jurisdictions_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "documents_user_id_deleted_at_idx" ON "documents"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "documents_content_hash_idx" ON "documents"("content_hash");

-- CreateIndex
CREATE INDEX "abuse_reports_document_id_idx" ON "abuse_reports"("document_id");

-- CreateIndex
CREATE INDEX "abuse_reports_reporter_id_idx" ON "abuse_reports"("reporter_id");

-- CreateIndex
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "representatives_external_id_key" ON "representatives"("external_id");

-- CreateIndex
CREATE INDEX "representatives_name_idx" ON "representatives"("name");

-- CreateIndex
CREATE INDEX "representatives_last_name_idx" ON "representatives"("last_name");

-- CreateIndex
CREATE INDEX "representatives_chamber_idx" ON "representatives"("chamber");

-- CreateIndex
CREATE INDEX "representatives_party_idx" ON "representatives"("party");

-- CreateIndex
CREATE INDEX "representatives_region_id_idx" ON "representatives"("region_id");

-- CreateIndex
CREATE INDEX "representatives_region_id_chamber_idx" ON "representatives"("region_id", "chamber");

-- CreateIndex
CREATE UNIQUE INDEX "legislative_committees_external_id_key" ON "legislative_committees"("external_id");

-- CreateIndex
CREATE INDEX "legislative_committees_chamber_idx" ON "legislative_committees"("chamber");

-- CreateIndex
CREATE INDEX "legislative_committees_name_idx" ON "legislative_committees"("name");

-- CreateIndex
CREATE INDEX "representative_committee_assignments_legislative_committee__idx" ON "representative_committee_assignments"("legislative_committee_id");

-- CreateIndex
CREATE UNIQUE INDEX "representative_committee_assignments_representative_id_legi_key" ON "representative_committee_assignments"("representative_id", "legislative_committee_id");

-- CreateIndex
CREATE UNIQUE INDEX "propositions_external_id_key" ON "propositions"("external_id");

-- CreateIndex
CREATE INDEX "propositions_status_idx" ON "propositions"("status");

-- CreateIndex
CREATE INDEX "propositions_election_date_idx" ON "propositions"("election_date");

-- CreateIndex
CREATE UNIQUE INDEX "minutes_external_id_key" ON "minutes"("external_id");

-- CreateIndex
CREATE INDEX "minutes_date_idx" ON "minutes"("date" DESC);

-- CreateIndex
CREATE INDEX "minutes_body_date_idx" ON "minutes"("body", "date" DESC);

-- CreateIndex
CREATE INDEX "minutes_committee_id_date_idx" ON "minutes"("committee_id", "date" DESC);

-- CreateIndex
CREATE INDEX "minutes_meeting_id_idx" ON "minutes"("meeting_id");

-- CreateIndex
CREATE INDEX "minutes_is_active_idx" ON "minutes"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "legislative_actions_external_id_key" ON "legislative_actions"("external_id");

-- CreateIndex
CREATE INDEX "legislative_actions_minutes_id_idx" ON "legislative_actions"("minutes_id");

-- CreateIndex
CREATE INDEX "legislative_actions_representative_id_date_idx" ON "legislative_actions"("representative_id", "date" DESC);

-- CreateIndex
CREATE INDEX "legislative_actions_proposition_id_date_idx" ON "legislative_actions"("proposition_id", "date" DESC);

-- CreateIndex
CREATE INDEX "legislative_actions_committee_id_date_idx" ON "legislative_actions"("committee_id", "date" DESC);

-- CreateIndex
CREATE INDEX "legislative_actions_body_date_idx" ON "legislative_actions"("body", "date" DESC);

-- CreateIndex
CREATE INDEX "legislative_actions_action_type_idx" ON "legislative_actions"("action_type");

-- CreateIndex
CREATE INDEX "document_propositions_document_id_idx" ON "document_propositions"("document_id");

-- CreateIndex
CREATE INDEX "document_propositions_proposition_id_idx" ON "document_propositions"("proposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_propositions_document_id_proposition_id_key" ON "document_propositions"("document_id", "proposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_external_id_key" ON "meetings"("external_id");

-- CreateIndex
CREATE INDEX "meetings_body_idx" ON "meetings"("body");

-- CreateIndex
CREATE INDEX "meetings_scheduled_at_idx" ON "meetings"("scheduled_at");

-- CreateIndex
CREATE INDEX "civics_blocks_region_id_idx" ON "civics_blocks"("region_id");

-- CreateIndex
CREATE INDEX "civics_blocks_region_id_extracted_at_idx" ON "civics_blocks"("region_id", "extracted_at");

-- CreateIndex
CREATE UNIQUE INDEX "civics_blocks_region_id_source_url_key" ON "civics_blocks"("region_id", "source_url");

-- CreateIndex
CREATE INDEX "glossary_entries_region_id_term_idx" ON "glossary_entries"("region_id", "term");

-- CreateIndex
CREATE UNIQUE INDEX "glossary_entries_region_id_slug_key" ON "glossary_entries"("region_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "bills_external_id_key" ON "bills"("external_id");

-- CreateIndex
CREATE INDEX "bills_region_id_session_year_idx" ON "bills"("region_id", "session_year");

-- CreateIndex
CREATE INDEX "bills_region_id_measure_type_code_idx" ON "bills"("region_id", "measure_type_code");

-- CreateIndex
CREATE INDEX "bills_author_id_idx" ON "bills"("author_id");

-- CreateIndex
CREATE INDEX "bills_status_idx" ON "bills"("status");

-- CreateIndex
CREATE INDEX "bills_last_action_date_idx" ON "bills"("last_action_date" DESC);

-- CreateIndex
CREATE INDEX "bill_co_authors_representative_id_idx" ON "bill_co_authors"("representative_id");

-- CreateIndex
CREATE INDEX "bill_committee_assignments_legislative_committee_id_idx" ON "bill_committee_assignments"("legislative_committee_id");

-- CreateIndex
CREATE INDEX "bill_votes_bill_id_idx" ON "bill_votes"("bill_id");

-- CreateIndex
CREATE INDEX "bill_votes_representative_id_vote_date_idx" ON "bill_votes"("representative_id", "vote_date" DESC);

-- CreateIndex
CREATE INDEX "bill_votes_vote_date_idx" ON "bill_votes"("vote_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bill_votes_bill_id_representative_id_vote_date_chamber_key" ON "bill_votes"("bill_id", "representative_id", "vote_date", "chamber");

-- CreateIndex
CREATE UNIQUE INDEX "region_plugins_name_key" ON "region_plugins"("name");

-- CreateIndex
CREATE UNIQUE INDEX "region_plugins_fips_code_key" ON "region_plugins"("fips_code");

-- CreateIndex
CREATE INDEX "region_plugins_enabled_idx" ON "region_plugins"("enabled");

-- CreateIndex
CREATE INDEX "region_plugins_parent_region_id_idx" ON "region_plugins"("parent_region_id");

-- CreateIndex
CREATE UNIQUE INDEX "committees_external_id_key" ON "committees"("external_id");

-- CreateIndex
CREATE INDEX "committees_name_idx" ON "committees"("name");

-- CreateIndex
CREATE INDEX "committees_type_idx" ON "committees"("type");

-- CreateIndex
CREATE INDEX "committees_source_system_idx" ON "committees"("source_system");

-- CreateIndex
CREATE INDEX "committees_proposition_id_idx" ON "committees"("proposition_id");

-- CreateIndex
CREATE INDEX "committee_measure_positions_proposition_id_position_idx" ON "committee_measure_positions"("proposition_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "committee_measure_positions_committee_id_proposition_id_pos_key" ON "committee_measure_positions"("committee_id", "proposition_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "cvr2_filings_external_id_key" ON "cvr2_filings"("external_id");

-- CreateIndex
CREATE INDEX "cvr2_filings_filing_id_idx" ON "cvr2_filings"("filing_id");

-- CreateIndex
CREATE INDEX "cvr2_filings_ballot_name_idx" ON "cvr2_filings"("ballot_name");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_external_id_key" ON "contributions"("external_id");

-- CreateIndex
CREATE INDEX "contributions_committee_id_idx" ON "contributions"("committee_id");

-- CreateIndex
CREATE INDEX "contributions_donor_name_idx" ON "contributions"("donor_name");

-- CreateIndex
CREATE INDEX "contributions_date_idx" ON "contributions"("date");

-- CreateIndex
CREATE INDEX "contributions_amount_idx" ON "contributions"("amount");

-- CreateIndex
CREATE INDEX "contributions_source_system_idx" ON "contributions"("source_system");

-- CreateIndex
CREATE UNIQUE INDEX "expenditures_external_id_key" ON "expenditures"("external_id");

-- CreateIndex
CREATE INDEX "expenditures_committee_id_idx" ON "expenditures"("committee_id");

-- CreateIndex
CREATE INDEX "expenditures_payee_name_idx" ON "expenditures"("payee_name");

-- CreateIndex
CREATE INDEX "expenditures_date_idx" ON "expenditures"("date");

-- CreateIndex
CREATE INDEX "expenditures_source_system_idx" ON "expenditures"("source_system");

-- CreateIndex
CREATE INDEX "expenditures_proposition_id_idx" ON "expenditures"("proposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "independent_expenditures_external_id_key" ON "independent_expenditures"("external_id");

-- CreateIndex
CREATE INDEX "independent_expenditures_committee_id_idx" ON "independent_expenditures"("committee_id");

-- CreateIndex
CREATE INDEX "independent_expenditures_candidate_name_idx" ON "independent_expenditures"("candidate_name");

-- CreateIndex
CREATE INDEX "independent_expenditures_proposition_title_idx" ON "independent_expenditures"("proposition_title");

-- CreateIndex
CREATE INDEX "independent_expenditures_proposition_id_idx" ON "independent_expenditures"("proposition_id");

-- CreateIndex
CREATE INDEX "independent_expenditures_date_idx" ON "independent_expenditures"("date");

-- CreateIndex
CREATE INDEX "independent_expenditures_support_or_oppose_idx" ON "independent_expenditures"("support_or_oppose");

-- CreateIndex
CREATE INDEX "independent_expenditures_source_system_idx" ON "independent_expenditures"("source_system");

-- CreateIndex
CREATE INDEX "idx_manifest_active_lookup" ON "structural_manifests"("region_id", "source_url", "data_type", "is_active");

-- CreateIndex
CREATE INDEX "structural_manifests_structure_hash_idx" ON "structural_manifests"("structure_hash");

-- CreateIndex
CREATE INDEX "structural_manifests_created_at_idx" ON "structural_manifests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "structural_manifests_region_id_source_url_data_type_version_key" ON "structural_manifests"("region_id", "source_url", "data_type", "version");

-- CreateIndex
CREATE INDEX "pipeline_executions_region_id_data_type_executed_at_idx" ON "pipeline_executions"("region_id", "data_type", "executed_at");

-- CreateIndex
CREATE INDEX "pipeline_executions_manifest_id_idx" ON "pipeline_executions"("manifest_id");

-- CreateIndex
CREATE INDEX "pipeline_executions_executed_at_idx" ON "pipeline_executions"("executed_at");

-- CreateIndex
CREATE INDEX "pipeline_executions_pipeline_job_id_idx" ON "pipeline_executions"("pipeline_job_id");

-- Partial unique index: one execution per (job, source_url); NULLs allowed for inline/dev runs.
-- Not expressible in Prisma schema syntax (partial WHERE clause).
CREATE UNIQUE INDEX "pipeline_executions_job_source_idx"
  ON "pipeline_executions" ("pipeline_job_id", "source_url")
  WHERE pipeline_job_id IS NOT NULL;

-- CreateIndex
CREATE INDEX "pipeline_execution_batches_execution_id_idx" ON "pipeline_execution_batches"("execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_execution_batches_execution_id_batch_index_key" ON "pipeline_execution_batches"("execution_id", "batch_index");

-- CreateIndex
CREATE INDEX "pipeline_jobs_status_enqueued_at_idx" ON "pipeline_jobs"("status", "enqueued_at");

-- CreateIndex
CREATE INDEX "pipeline_jobs_region_id_enqueued_at_idx" ON "pipeline_jobs"("region_id", "enqueued_at" DESC);

-- CreateIndex
CREATE INDEX "pipeline_jobs_bullmq_job_id_idx" ON "pipeline_jobs"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "pipeline_jobs_trigger_source_enqueued_at_idx" ON "pipeline_jobs"("trigger_source", "enqueued_at" DESC);

-- CreateIndex
CREATE INDEX "structural_analysis_jobs_status_enqueued_at_idx" ON "structural_analysis_jobs"("status", "enqueued_at");

-- CreateIndex
CREATE INDEX "structural_analysis_jobs_region_id_source_url_data_type_enq_idx" ON "structural_analysis_jobs"("region_id", "source_url", "data_type", "enqueued_at" DESC);

-- CreateIndex
CREATE INDEX "structural_analysis_jobs_bullmq_job_id_idx" ON "structural_analysis_jobs"("bullmq_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_watermarks_region_id_source_url_data_type_key" ON "ingestion_watermarks"("region_id", "source_url", "data_type");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_name_key" ON "prompt_templates"("name");

-- CreateIndex
CREATE INDEX "prompt_templates_category_is_active_idx" ON "prompt_templates"("category", "is_active");

-- CreateIndex
CREATE INDEX "prompt_templates_name_idx" ON "prompt_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_fips_code_key" ON "jurisdictions"("fips_code");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_ocd_id_key" ON "jurisdictions"("ocd_id");

-- CreateIndex
CREATE INDEX "jurisdictions_type_idx" ON "jurisdictions"("type");

-- CreateIndex
CREATE INDEX "jurisdictions_level_idx" ON "jurisdictions"("level");

-- CreateIndex
CREATE INDEX "jurisdictions_state_code_idx" ON "jurisdictions"("state_code");

-- CreateIndex
CREATE INDEX "jurisdictions_parent_id_idx" ON "jurisdictions"("parent_id");

-- CreateIndex
CREATE INDEX "user_jurisdictions_user_id_idx" ON "user_jurisdictions"("user_id");

-- CreateIndex
CREATE INDEX "user_jurisdictions_user_address_id_idx" ON "user_jurisdictions"("user_address_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_jurisdictions_user_address_id_jurisdiction_id_key" ON "user_jurisdictions"("user_address_id", "jurisdiction_id");

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

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representative_committee_assignments" ADD CONSTRAINT "representative_committee_assignments_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representative_committee_assignments" ADD CONSTRAINT "representative_committee_assignments_legislative_committee_fkey" FOREIGN KEY ("legislative_committee_id") REFERENCES "legislative_committees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minutes" ADD CONSTRAINT "minutes_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "legislative_committees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minutes" ADD CONSTRAINT "minutes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_actions" ADD CONSTRAINT "legislative_actions_minutes_id_fkey" FOREIGN KEY ("minutes_id") REFERENCES "minutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_actions" ADD CONSTRAINT "legislative_actions_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_actions" ADD CONSTRAINT "legislative_actions_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_actions" ADD CONSTRAINT "legislative_actions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "legislative_committees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "representatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_co_authors" ADD CONSTRAINT "bill_co_authors_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_co_authors" ADD CONSTRAINT "bill_co_authors_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_committee_assignments" ADD CONSTRAINT "bill_committee_assignments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_committee_assignments" ADD CONSTRAINT "bill_committee_assignments_legislative_committee_id_fkey" FOREIGN KEY ("legislative_committee_id") REFERENCES "legislative_committees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_measure_positions" ADD CONSTRAINT "committee_measure_positions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_measure_positions" ADD CONSTRAINT "committee_measure_positions_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "independent_expenditures" ADD CONSTRAINT "independent_expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "independent_expenditures" ADD CONSTRAINT "independent_expenditures_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_pipeline_job_id_fkey" FOREIGN KEY ("pipeline_job_id") REFERENCES "pipeline_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_execution_batches" ADD CONSTRAINT "pipeline_execution_batches_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "pipeline_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_jurisdictions" ADD CONSTRAINT "user_jurisdictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_jurisdictions" ADD CONSTRAINT "user_jurisdictions_user_address_id_fkey" FOREIGN KEY ("user_address_id") REFERENCES "user_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_jurisdictions" ADD CONSTRAINT "user_jurisdictions_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint on pipeline_executions.status.
-- Not expressible in Prisma schema syntax.
ALTER TABLE "pipeline_executions"
  ADD CONSTRAINT "pipeline_executions_status_check"
  CHECK (status IN ('running', 'completed', 'failed'));
