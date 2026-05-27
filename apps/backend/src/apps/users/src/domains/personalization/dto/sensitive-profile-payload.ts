/**
 * Shape of the SensitiveProfile JSON that gets encrypted at rest. The
 * fields here cover doc categories §4.4 (income), §4.5 (health),
 * §4.8 (citizenship & justice), and §4.9 (cultural & community identity).
 *
 * Every field is optional. The whole object is treated as opaque from
 * Prisma's perspective — service code (de)serializes and (de)encrypts
 * at the field boundary. Consumers in the relevance engine receive
 * boolean-flag derivations resolved at the federation boundary, never
 * these raw values (see doc §6.3).
 *
 * Adding a new T3 field is a code-only change here — no Prisma migration
 * required.
 */
export interface SensitiveProfilePayload {
  // §4.4 Work — income band (the rest of work lives in SignalProfile)
  incomeBand?: string;
  publicBenefits?: string[];

  // §4.5 Health
  insuranceType?: string;
  chronicConditionCategories?: string[];
  caregiverFor?: string[];
  reproductiveHealthRelevance?: boolean;

  // §4.8 Citizenship & justice
  citizenshipStatus?: string;
  veteranStatus?: string;
  justiceInvolvement?: string[];

  // §4.9 Cultural & community identity
  raceEthnicity?: string[];
  primaryLanguages?: string[];
  religiousCommunity?: string;
  lgbtqIdentity?: string;
  immigrationGeneration?: 1 | 2 | 3;
  tribalAffiliation?: string;
}

/**
 * Type guard for the encrypted payload after JSON parse. Defensive against
 * future shape evolution — unknown fields are dropped on read but kept on
 * write (re-encrypted as-is) so a downgrade doesn't lose data.
 */
export function isSensitiveProfilePayload(
  raw: unknown,
): raw is SensitiveProfilePayload {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}
