import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add profile enhancement columns
 *
 * Adds new fields to user_profiles for:
 * - Profile visibility (isPublic)
 * - Avatar storage key
 * - Civic fields (political affiliation, voting frequency, policy priorities)
 * - Demographic fields (occupation, education, income, household, homeowner status)
 */
export class AddProfileEnhancements1735100000000 implements MigrationInterface {
  name = 'AddProfileEnhancements1735100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE "political_affiliation_enum" AS ENUM (
        'democrat', 'republican', 'independent', 'libertarian',
        'green', 'other', 'prefer_not_to_say'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "voting_frequency_enum" AS ENUM (
        'every_election', 'most_elections', 'some_elections',
        'rarely', 'never', 'prefer_not_to_say'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "education_level_enum" AS ENUM (
        'high_school', 'some_college', 'associate', 'bachelor',
        'master', 'doctorate', 'trade_school', 'prefer_not_to_say'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "income_range_enum" AS ENUM (
        'under_25k', '25k_50k', '50k_75k', '75k_100k',
        '100k_150k', '150k_200k', 'over_200k', 'prefer_not_to_say'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "homeowner_status_enum" AS ENUM (
        'own', 'rent', 'living_with_family', 'other', 'prefer_not_to_say'
      )
    `);

    // Add profile visibility
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false
    `);

    // Add avatar storage key
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "avatarStorageKey" VARCHAR(255)
    `);

    // Add civic fields
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "politicalAffiliation" political_affiliation_enum
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "votingFrequency" voting_frequency_enum
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "policyPriorities" TEXT[]
    `);

    // Add demographic fields
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "occupation" VARCHAR(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "educationLevel" education_level_enum
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "incomeRange" income_range_enum
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "householdSize" VARCHAR(50)
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      ADD COLUMN "homeownerStatus" homeowner_status_enum
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "homeownerStatus"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "householdSize"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "incomeRange"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "educationLevel"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "occupation"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "policyPriorities"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "votingFrequency"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "politicalAffiliation"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "avatarStorageKey"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profiles"
      DROP COLUMN IF EXISTS "isPublic"
    `);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "homeowner_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "income_range_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "education_level_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "voting_frequency_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "political_affiliation_enum"`);
  }
}
