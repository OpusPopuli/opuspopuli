-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('structural_analysis', 'document_analysis', 'rag');

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
    "error_message" TEXT,
    "llm_provider" VARCHAR(50),
    "llm_model" VARCHAR(100),
    "llm_tokens_used" INTEGER,
    "executed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_executions_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "independent_expenditures_external_id_key" ON "independent_expenditures"("external_id");

-- CreateIndex
CREATE INDEX "independent_expenditures_committee_id_idx" ON "independent_expenditures"("committee_id");

-- CreateIndex
CREATE INDEX "independent_expenditures_candidate_name_idx" ON "independent_expenditures"("candidate_name");

-- CreateIndex
CREATE INDEX "independent_expenditures_proposition_title_idx" ON "independent_expenditures"("proposition_title");

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
CREATE UNIQUE INDEX "prompt_templates_name_key" ON "prompt_templates"("name");

-- CreateIndex
CREATE INDEX "prompt_templates_category_is_active_idx" ON "prompt_templates"("category", "is_active");

-- CreateIndex
CREATE INDEX "prompt_templates_name_idx" ON "prompt_templates"("name");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "independent_expenditures" ADD CONSTRAINT "independent_expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
