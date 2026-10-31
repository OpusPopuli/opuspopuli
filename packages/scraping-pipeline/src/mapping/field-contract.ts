/**
 * The fields a manifest must name for its data type's mapper to produce
 * anything (meetings-phase-b.md M1).
 *
 * The structural-schema prompt already lists these names, and the model has
 * ignored it: three Assembly meetings manifests in a row named their fields
 * `date`, `time` and `committeeName`. The selectors were right, every item was
 * dropped for lacking `title`/`externalId`, and nothing noticed, because the
 * validator checks items against the manifest's OWN required fields. A prompt
 * rule that fails keeps failing, so the names are enforced here instead.
 *
 * Each entry is a list of alternatives: the manifest must name at least one
 * of them. Only what the mapper cannot do without belongs here. `meetings`
 * accepts `title` or `externalId` because `composeMeetingExternalId` can build
 * an id from a title. A field the mapper defaults (`body`, `party`, `status`)
 * is not part of the contract.
 *
 * Checked against the manifest's names, never against item values. A page of
 * "No hearings scheduled" placeholder rows legitimately yields items with no
 * identity, and must not trigger a re-analysis every run (#966 W1).
 *
 * `campaign_finance` has no entry: its mapper routes each record by which keys
 * are present, across a dozen record kinds, so no single set of names is
 * required of every manifest.
 */

import { DataType } from "@opuspopuli/common";

type FieldContract = readonly (readonly string[])[];

const REQUIRED_DOMAIN_FIELDS: Partial<Record<DataType, FieldContract>> = {
  [DataType.MEETINGS]: [["scheduledAt"], ["title", "externalId"]],
  [DataType.PROPOSITIONS]: [["externalId"], ["title"]],
  [DataType.REPRESENTATIVES]: [["externalId"], ["name"]],
};

/**
 * The contract entries a set of field names fails to cover, each rendered as
 * its alternatives joined by `|` (e.g. `title|externalId`). Empty when the
 * contract is met, or when the data type has none.
 */
export function findFieldContractGaps(
  dataType: DataType,
  fieldNames: Iterable<string>,
): string[] {
  const contract = REQUIRED_DOMAIN_FIELDS[dataType];
  if (!contract) return [];
  const named = new Set(fieldNames);
  return contract
    .filter((alternatives) => !alternatives.some((f) => named.has(f)))
    .map((alternatives) => alternatives.join("|"));
}
