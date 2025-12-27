import { registerEnumType } from '@nestjs/graphql';

/**
 * Political affiliation options
 */
export enum PoliticalAffiliation {
  DEMOCRAT = 'democrat',
  REPUBLICAN = 'republican',
  INDEPENDENT = 'independent',
  LIBERTARIAN = 'libertarian',
  GREEN = 'green',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

registerEnumType(PoliticalAffiliation, {
  name: 'PoliticalAffiliation',
  description: 'Political party affiliation',
});

/**
 * Voting frequency options
 */
export enum VotingFrequency {
  EVERY_ELECTION = 'every_election',
  MOST_ELECTIONS = 'most_elections',
  SOME_ELECTIONS = 'some_elections',
  RARELY = 'rarely',
  NEVER = 'never',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

registerEnumType(VotingFrequency, {
  name: 'VotingFrequency',
  description: 'How often the user votes',
});

/**
 * Education level options
 */
export enum EducationLevel {
  HIGH_SCHOOL = 'high_school',
  SOME_COLLEGE = 'some_college',
  ASSOCIATE = 'associate',
  BACHELOR = 'bachelor',
  MASTER = 'master',
  DOCTORATE = 'doctorate',
  TRADE_SCHOOL = 'trade_school',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

registerEnumType(EducationLevel, {
  name: 'EducationLevel',
  description: 'Highest education level completed',
});

/**
 * Income range options
 */
export enum IncomeRange {
  UNDER_25K = 'under_25k',
  RANGE_25K_50K = '25k_50k',
  RANGE_50K_75K = '50k_75k',
  RANGE_75K_100K = '75k_100k',
  RANGE_100K_150K = '100k_150k',
  RANGE_150K_200K = '150k_200k',
  OVER_200K = 'over_200k',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

registerEnumType(IncomeRange, {
  name: 'IncomeRange',
  description: 'Annual household income range',
});

/**
 * Homeowner status options
 */
export enum HomeownerStatus {
  OWN = 'own',
  RENT = 'rent',
  LIVING_WITH_FAMILY = 'living_with_family',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

registerEnumType(HomeownerStatus, {
  name: 'HomeownerStatus',
  description: 'Home ownership status',
});

/**
 * Policy priority categories for civic engagement
 */
export const POLICY_PRIORITY_OPTIONS = [
  'healthcare',
  'economy',
  'education',
  'environment',
  'immigration',
  'gun_rights',
  'gun_control',
  'social_security',
  'taxes',
  'criminal_justice',
  'housing',
  'infrastructure',
  'national_security',
  'civil_rights',
  'womens_rights',
  'lgbtq_rights',
  'veterans_affairs',
  'labor_unions',
  'small_business',
  'agriculture',
] as const;

export type PolicyPriority = (typeof POLICY_PRIORITY_OPTIONS)[number];
