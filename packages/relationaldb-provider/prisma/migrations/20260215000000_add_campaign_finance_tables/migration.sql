-- Campaign Finance Tables
-- Supports both California (CAL-ACCESS) and Federal (FEC) data sources

-- Committees: the entities that raise and spend money
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

-- Contributions: money received by a committee
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

-- Expenditures: money spent by a committee
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

-- Independent Expenditures: outside spending for/against candidates or measures
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

-- Unique constraints
CREATE UNIQUE INDEX "committees_external_id_key" ON "committees"("external_id");
CREATE UNIQUE INDEX "contributions_external_id_key" ON "contributions"("external_id");
CREATE UNIQUE INDEX "expenditures_external_id_key" ON "expenditures"("external_id");
CREATE UNIQUE INDEX "independent_expenditures_external_id_key" ON "independent_expenditures"("external_id");

-- Committee indexes
CREATE INDEX "committees_name_idx" ON "committees"("name");
CREATE INDEX "committees_type_idx" ON "committees"("type");
CREATE INDEX "committees_source_system_idx" ON "committees"("source_system");
CREATE INDEX "committees_proposition_id_idx" ON "committees"("proposition_id");

-- Contribution indexes
CREATE INDEX "contributions_committee_id_idx" ON "contributions"("committee_id");
CREATE INDEX "contributions_donor_name_idx" ON "contributions"("donor_name");
CREATE INDEX "contributions_date_idx" ON "contributions"("date");
CREATE INDEX "contributions_amount_idx" ON "contributions"("amount");
CREATE INDEX "contributions_source_system_idx" ON "contributions"("source_system");

-- Expenditure indexes
CREATE INDEX "expenditures_committee_id_idx" ON "expenditures"("committee_id");
CREATE INDEX "expenditures_payee_name_idx" ON "expenditures"("payee_name");
CREATE INDEX "expenditures_date_idx" ON "expenditures"("date");
CREATE INDEX "expenditures_source_system_idx" ON "expenditures"("source_system");

-- Independent expenditure indexes
CREATE INDEX "independent_expenditures_committee_id_idx" ON "independent_expenditures"("committee_id");
CREATE INDEX "independent_expenditures_candidate_name_idx" ON "independent_expenditures"("candidate_name");
CREATE INDEX "independent_expenditures_proposition_title_idx" ON "independent_expenditures"("proposition_title");
CREATE INDEX "independent_expenditures_date_idx" ON "independent_expenditures"("date");
CREATE INDEX "independent_expenditures_support_or_oppose_idx" ON "independent_expenditures"("support_or_oppose");
CREATE INDEX "independent_expenditures_source_system_idx" ON "independent_expenditures"("source_system");

-- Foreign keys
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "independent_expenditures" ADD CONSTRAINT "independent_expenditures_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
