/**
 * Single source of truth for the model-of-me edit surface (#752).
 *
 * Each `FieldDescriptor` declares everything the `<EditableField>`
 * dispatch needs: the GraphQL field name, which profile it lives in
 * (SignalProfile / SensitiveProfile), the input UX type, controlled
 * vocab where applicable, and the i18n key root.
 *
 * Controlled-vocab values match what the onboarding flow (#758) writes
 * to the database. Planning doc §4 has a richer set in places —
 * "unemployed", "retired", "rideshare", "remote_work" etc. — and the
 * options here are a deliberate subset to avoid orphan values until
 * the shared `@opuspopuli/personalization-vocab` package (#762) lands
 * and the onboarding chips can broaden.
 *
 * Cross-service contract: the values here must match the knowledge
 * ranker's WHO_TO_FLAG table in `scoring.service.ts`. Drift will
 * silently miscategorize bills. #762 is the long-term fix.
 */

export type InputType =
  | "string-select"
  | "string-input"
  | "boolean"
  | "multi-select-chips"
  | "multi-tag-input"
  | "integer"
  | "state";

export type Tier = "T1" | "T2" | "T3";

export type Category =
  | "housing"
  | "household"
  | "work"
  | "transit"
  | "education"
  | "values"
  | "community"
  | "attention"
  | "relational"
  | "income"
  | "health"
  | "civic_status"
  | "cultural";

export interface FieldDescriptor {
  /** GraphQL field name — must match SignalProfile or SensitiveProfile. */
  readonly name: string;
  /** Which row this field lives in. */
  readonly profile: "signal" | "sensitive";
  readonly category: Category;
  readonly tier: Tier;
  readonly inputType: InputType;
  /** Controlled vocab for `string-select` and `multi-select-chips`. */
  readonly options?: readonly string[];
  /** Bounds for `integer` inputs. */
  readonly min?: number;
  readonly max?: number;
  /** Mirrors the backend DTO's @MaxLength constraint. */
  readonly maxLength?: number;
  /** i18n key root under the `profile` namespace. */
  readonly i18nKey: string;
}

// ============================================================
// SignalProfile fields (T1 + T2) — §4.2–§4.14 of the planning doc
// ============================================================

const SIGNAL_FIELDS: readonly FieldDescriptor[] = [
  // §4.2 Housing
  {
    name: "housingTenure",
    profile: "signal",
    category: "housing",
    tier: "T2",
    inputType: "string-select",
    options: ["renter", "owner"],
    maxLength: 50,
    i18nKey: "housingTenure",
  },
  {
    name: "buildingType",
    profile: "signal",
    category: "housing",
    tier: "T2",
    inputType: "string-select",
    options: [
      "single_family",
      "condo",
      "townhome",
      "adu",
      "multifamily",
      "mobile_home",
      "rural",
      "rv",
    ],
    maxLength: 50,
    i18nKey: "buildingType",
  },
  {
    name: "taxExposure",
    profile: "signal",
    category: "housing",
    tier: "T2",
    inputType: "multi-select-chips",
    options: [
      "property_tax",
      "parcel_tax",
      "mello_roos",
      "hoa",
      "transfer_tax",
    ],
    i18nKey: "taxExposure",
  },
  {
    name: "housingFlags",
    profile: "signal",
    category: "housing",
    tier: "T2",
    inputType: "multi-select-chips",
    options: [
      "rent_regulated",
      "section_8",
      "first_time_buyer",
      "underwater_mortgage",
      "recently_moved",
    ],
    i18nKey: "housingFlags",
  },

  // §4.3 Household
  {
    name: "childrenAgeBands",
    profile: "signal",
    category: "household",
    tier: "T2",
    inputType: "multi-select-chips",
    options: ["0_5", "k_5", "6_12", "high_school", "college"],
    i18nKey: "childrenAgeBands",
  },
  {
    name: "hasEldercareDependents",
    profile: "signal",
    category: "household",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "hasEldercareDependents",
  },
  {
    name: "multigenerational",
    profile: "signal",
    category: "household",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "multigenerational",
  },
  {
    name: "hasPets",
    profile: "signal",
    category: "household",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "hasPets",
  },
  {
    name: "partnerStatus",
    profile: "signal",
    category: "household",
    tier: "T2",
    inputType: "string-select",
    options: ["single", "partnered", "married", "divorced", "widowed"],
    maxLength: 50,
    i18nKey: "partnerStatus",
  },

  // §4.4 Work (income band lives in SensitiveProfile)
  {
    name: "employmentStatus",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "string-select",
    options: ["employed", "gig", "business_owner"],
    maxLength: 50,
    i18nKey: "employmentStatus",
  },
  {
    name: "industry",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "string-input",
    maxLength: 100,
    i18nKey: "industry",
  },
  {
    name: "occupationCategory",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "string-input",
    maxLength: 100,
    i18nKey: "occupationCategory",
  },
  {
    name: "employerSizeBand",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "string-select",
    options: [
      "under_5",
      "5_to_50",
      "50_to_500",
      "over_500",
      "public_sector",
      "nonprofit",
    ],
    maxLength: 50,
    i18nKey: "employerSizeBand",
  },
  {
    name: "unionMember",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "unionMember",
  },
  {
    name: "gigWorker",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "gigWorker",
  },
  {
    name: "tippedWorker",
    profile: "signal",
    category: "work",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "tippedWorker",
  },

  // §4.6 Transportation
  {
    name: "primaryTransitMode",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "string-select",
    options: ["transit", "car", "active"],
    maxLength: 50,
    i18nKey: "primaryTransitMode",
  },
  {
    name: "vehicleTypes",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "multi-select-chips",
    options: ["ev", "hybrid", "ice", "truck", "motorcycle", "none"],
    i18nKey: "vehicleTypes",
  },
  {
    name: "commuteBand",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "string-select",
    options: [
      "under_5_mi",
      "5_to_15_mi",
      "15_to_30_mi",
      "over_30_mi",
      "remote",
    ],
    maxLength: 30,
    i18nKey: "commuteBand",
  },
  {
    name: "specialLicenses",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "multi-select-chips",
    options: ["cdl", "pilot", "mariner", "hazmat"],
    i18nKey: "specialLicenses",
  },
  {
    name: "transitPassHolder",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "transitPassHolder",
  },
  {
    name: "bikeShareMember",
    profile: "signal",
    category: "transit",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "bikeShareMember",
  },

  // §4.7 Education
  {
    name: "studentLevel",
    profile: "signal",
    category: "education",
    tier: "T2",
    inputType: "string-select",
    options: ["k12", "vocational", "college", "grad"],
    maxLength: 30,
    i18nKey: "studentLevel",
  },
  {
    name: "parentOfStudent",
    profile: "signal",
    category: "education",
    tier: "T2",
    inputType: "multi-select-chips",
    options: ["public", "private", "charter", "homeschool"],
    i18nKey: "parentOfStudent",
  },
  {
    name: "educator",
    profile: "signal",
    category: "education",
    tier: "T2",
    inputType: "boolean",
    i18nKey: "educator",
  },

  // §4.10 Declared values & priorities (T1)
  {
    name: "interestTags",
    profile: "signal",
    category: "values",
    tier: "T1",
    inputType: "multi-select-chips",
    options: [
      "housing",
      "jobs",
      "healthcare",
      "education",
      "transit",
      "environment",
      "public_safety",
      "taxes",
      "immigration",
      "voting_rights",
      "justice",
      "family",
    ],
    i18nKey: "interestTags",
  },
  // convictionStrength is a JSON map (tag → strength) — deferred to v1.1
  // because it requires a more complex per-tag edit UI than a flat chip
  // group. Read-only display lives in the placeholder for now.
  {
    name: "politicalSelfId",
    profile: "signal",
    category: "values",
    tier: "T1",
    inputType: "string-input",
    maxLength: 100,
    i18nKey: "politicalSelfId",
  },

  // §4.11 Organizational affiliations
  {
    name: "trustedOrganizations",
    profile: "signal",
    category: "community",
    tier: "T2",
    inputType: "multi-tag-input",
    i18nKey: "trustedOrganizations",
  },
  {
    name: "unionAffiliation",
    profile: "signal",
    category: "community",
    tier: "T2",
    inputType: "string-input",
    maxLength: 255,
    i18nKey: "unionAffiliation",
  },
  {
    name: "faithCommunity",
    profile: "signal",
    category: "community",
    tier: "T2",
    inputType: "string-input",
    maxLength: 255,
    i18nKey: "faithCommunity",
  },

  // §4.13 Attention budget & format preference
  {
    name: "weeklyAttentionMinutes",
    profile: "signal",
    category: "attention",
    tier: "T1",
    inputType: "integer",
    min: 0,
    max: 10080,
    i18nKey: "weeklyAttentionMinutes",
  },
  {
    name: "preferredDepth",
    profile: "signal",
    category: "attention",
    tier: "T1",
    inputType: "string-select",
    options: ["headline", "summary", "brief", "source"],
    maxLength: 30,
    i18nKey: "preferredDepth",
  },
  {
    name: "accessibilityNeeds",
    profile: "signal",
    category: "attention",
    tier: "T1",
    inputType: "multi-select-chips",
    options: [
      "screen_reader",
      "plain_language",
      "translation",
      "dyslexia_friendly",
    ],
    i18nKey: "accessibilityNeeds",
  },
  {
    name: "readingLevel",
    profile: "signal",
    category: "attention",
    tier: "T1",
    inputType: "string-select",
    options: ["plain", "standard", "technical"],
    maxLength: 30,
    i18nKey: "readingLevel",
  },

  // §4.14 Relational graph
  {
    name: "agingParentsState",
    profile: "signal",
    category: "relational",
    tier: "T2",
    inputType: "state",
    i18nKey: "agingParentsState",
  },
];

// ============================================================
// SensitiveProfile fields (T3) — §4.4 income, §4.5 health, §4.8
// civic status, §4.9 cultural & community identity. Encrypted at
// rest; service silently no-ops every write when noFieldsMode is on.
// ============================================================

const SENSITIVE_FIELDS: readonly FieldDescriptor[] = [
  // §4.4 income
  {
    name: "incomeBand",
    profile: "sensitive",
    category: "income",
    tier: "T3",
    inputType: "string-select",
    options: [
      "under_25k",
      "25k_50k",
      "50k_75k",
      "75k_100k",
      "100k_150k",
      "150k_200k",
      "over_200k",
    ],
    maxLength: 50,
    i18nKey: "incomeBand",
  },
  {
    name: "publicBenefits",
    profile: "sensitive",
    category: "income",
    tier: "T3",
    inputType: "multi-select-chips",
    options: ["snap", "medicaid", "wic", "ssdi", "unemployment", "eitc"],
    i18nKey: "publicBenefits",
  },

  // §4.5 Health
  {
    name: "insuranceType",
    profile: "sensitive",
    category: "health",
    tier: "T3",
    inputType: "string-select",
    options: [
      "employer",
      "medicare",
      "medicaid",
      "aca",
      "va",
      "tricare",
      "uninsured",
    ],
    maxLength: 50,
    i18nKey: "insuranceType",
  },
  {
    name: "chronicConditionCategories",
    profile: "sensitive",
    category: "health",
    tier: "T3",
    inputType: "multi-select-chips",
    options: [
      "cardiovascular",
      "metabolic",
      "respiratory",
      "mental_health",
      "musculoskeletal",
      "neurological",
      "other",
    ],
    i18nKey: "chronicConditionCategories",
  },
  {
    name: "caregiverFor",
    profile: "sensitive",
    category: "health",
    tier: "T3",
    inputType: "multi-select-chips",
    options: ["child", "parent", "disabled_family_member"],
    i18nKey: "caregiverFor",
  },
  {
    name: "reproductiveHealthRelevance",
    profile: "sensitive",
    category: "health",
    tier: "T3",
    inputType: "boolean",
    i18nKey: "reproductiveHealthRelevance",
  },

  // §4.8 Citizenship & justice
  {
    name: "citizenshipStatus",
    profile: "sensitive",
    category: "civic_status",
    tier: "T3",
    inputType: "string-select",
    options: [
      "citizen",
      "permanent_resident",
      "daca",
      "visa_holder",
      "asylum_seeking",
    ],
    maxLength: 50,
    i18nKey: "citizenshipStatus",
  },
  {
    name: "veteranStatus",
    profile: "sensitive",
    category: "civic_status",
    tier: "T3",
    inputType: "string-select",
    options: ["veteran", "active_duty", "military_family"],
    maxLength: 50,
    i18nKey: "veteranStatus",
  },
  {
    name: "justiceInvolvement",
    profile: "sensitive",
    category: "civic_status",
    tier: "T3",
    inputType: "multi-select-chips",
    options: [
      "currently_incarcerated",
      "formerly_incarcerated",
      "parole",
      "probation",
      "family_affected",
    ],
    i18nKey: "justiceInvolvement",
  },

  // §4.9 Cultural & community identity
  {
    name: "raceEthnicity",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "multi-select-chips",
    options: [
      "asian",
      "black",
      "hispanic_latino",
      "indigenous",
      "middle_eastern_north_african",
      "pacific_islander",
      "white",
      "multiracial",
      "other",
    ],
    i18nKey: "raceEthnicity",
  },
  {
    name: "primaryLanguages",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "multi-tag-input",
    i18nKey: "primaryLanguages",
  },
  {
    name: "religiousCommunity",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "string-input",
    maxLength: 255,
    i18nKey: "religiousCommunity",
  },
  {
    name: "lgbtqIdentity",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "string-input",
    maxLength: 100,
    i18nKey: "lgbtqIdentity",
  },
  {
    name: "immigrationGeneration",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "integer",
    min: 1,
    max: 3,
    i18nKey: "immigrationGeneration",
  },
  {
    name: "tribalAffiliation",
    profile: "sensitive",
    category: "cultural",
    tier: "T3",
    inputType: "string-input",
    maxLength: 255,
    i18nKey: "tribalAffiliation",
  },
];

export const ALL_FIELDS: readonly FieldDescriptor[] = [
  ...SIGNAL_FIELDS,
  ...SENSITIVE_FIELDS,
];

export const FIELDS_BY_CATEGORY: Record<Category, readonly FieldDescriptor[]> =
  ALL_FIELDS.reduce(
    (acc, field) => {
      acc[field.category] = [...(acc[field.category] ?? []), field];
      return acc;
    },
    {} as Record<Category, FieldDescriptor[]>,
  );

/**
 * Category display order on the page. T1+T2 first (top of page), T3
 * categories last (after the no-fields-mode disclosure). Collapsed-by-
 * default state is computed in `categories.ts`.
 */
export const CATEGORY_ORDER: readonly Category[] = [
  "values",
  "housing",
  "household",
  "work",
  "transit",
  "education",
  "community",
  "attention",
  "relational",
  "income",
  "health",
  "civic_status",
  "cultural",
];

export const TIER_BY_CATEGORY: Record<Category, Tier> = {
  values: "T1",
  attention: "T1",
  housing: "T2",
  household: "T2",
  work: "T2",
  transit: "T2",
  education: "T2",
  community: "T2",
  relational: "T2",
  income: "T3",
  health: "T3",
  civic_status: "T3",
  cultural: "T3",
};
