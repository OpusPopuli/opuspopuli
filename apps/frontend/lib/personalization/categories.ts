import {
  CATEGORY_ORDER,
  FIELDS_BY_CATEGORY,
  TIER_BY_CATEGORY,
  type Category,
  type FieldDescriptor,
} from "./vocab";

/**
 * UI presentation rules for the model-of-me page.
 *
 * T1+T2 categories sit above the no-fields-mode panel and start
 * expanded. T3 categories sit below the panel and start collapsed —
 * the disclosure is intentional (planning doc §9.2). The toggle's
 * `noFieldsMode=true` state also locks every T3 category visually.
 */

export interface CategoryPresentation {
  readonly category: Category;
  readonly fields: readonly FieldDescriptor[];
  readonly tier: "T1" | "T2" | "T3";
  readonly defaultExpanded: boolean;
}

const isSensitive = (category: Category): boolean =>
  TIER_BY_CATEGORY[category] === "T3";

export function getCategoryPresentations(): readonly CategoryPresentation[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    fields: FIELDS_BY_CATEGORY[category] ?? [],
    tier: TIER_BY_CATEGORY[category],
    defaultExpanded: !isSensitive(category),
  }));
}

export function partitionByTier(
  presentations: readonly CategoryPresentation[],
): {
  readonly nonSensitive: readonly CategoryPresentation[];
  readonly sensitive: readonly CategoryPresentation[];
} {
  return {
    nonSensitive: presentations.filter((p) => p.tier !== "T3"),
    sensitive: presentations.filter((p) => p.tier === "T3"),
  };
}
