-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('welcome', 'representative_contact', 'civic_update', 'election_reminder', 'ballot_update', 'account_activity');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'bounced');

-- CreateEnum
CREATE TYPE "NotificationFrequency" AS ENUM ('immediate', 'daily_digest', 'weekly_digest', 'never');

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

-- AddForeignKey
ALTER TABLE "email_correspondence" ADD CONSTRAINT "email_correspondence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
