-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('auto_analysis', 'user_manual');

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
    "plugin_type" VARCHAR(20) NOT NULL DEFAULT 'declarative',
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
CREATE UNIQUE INDEX "representatives_external_id_key" ON "representatives"("external_id");

-- CreateIndex
CREATE INDEX "representatives_name_idx" ON "representatives"("name");

-- CreateIndex
CREATE INDEX "representatives_chamber_idx" ON "representatives"("chamber");

-- CreateIndex
CREATE INDEX "representatives_party_idx" ON "representatives"("party");

-- CreateIndex
CREATE UNIQUE INDEX "propositions_external_id_key" ON "propositions"("external_id");

-- CreateIndex
CREATE INDEX "propositions_status_idx" ON "propositions"("status");

-- CreateIndex
CREATE INDEX "propositions_election_date_idx" ON "propositions"("election_date");

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
CREATE UNIQUE INDEX "region_plugins_name_key" ON "region_plugins"("name");

-- CreateIndex
CREATE INDEX "region_plugins_enabled_idx" ON "region_plugins"("enabled");

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom: pg_trgm GIN index on propositions.title for ILIKE search performance
-- Prisma cannot express GIN indexes natively, so this is managed via raw SQL
CREATE INDEX "propositions_title_trgm_idx" ON "propositions" USING GIN ("title" gin_trgm_ops);
