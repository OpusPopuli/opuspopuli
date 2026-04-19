import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element, AnyNode } from "domhandler";

/**
 * Extracts an array of structured objects from repeating elements matched by a CSS selector.
 *
 * Each matched element becomes one object; the `children` record maps child field names
 * to selectors that extract values from the element.
 *
 * Supported child selector formats:
 * - `"_text"` — the full text content of the element
 * - `"_regex:PATTERN"` — extract via regex capture group 1 from element text
 * - `"css-selector|attr:name"` — extract an attribute from a descendant
 * - `"css-selector"` — extract text content from a descendant (default)
 *
 * @param $ Cheerio API for DOM traversal
 * @param scope The element to search within (for .find())
 * @param selector CSS selector for the repeating items
 * @param children Map of field name → selector for per-item extraction
 * @returns Array of objects with extracted fields (empty if no matches or no values)
 */
export function extractStructuredArray(
  $: CheerioAPI,
  scope: Cheerio<Element> | Cheerio<AnyNode>,
  selector: string,
  children: Record<string, string>,
): Record<string, string>[] {
  if (!selector || !children) return [];

  const matches = scope.find(selector);
  const items: Record<string, string>[] = [];

  matches.each((_i, el) => {
    const item = extractChildFields($, el, children);
    if (Object.keys(item).length > 0) items.push(item);
  });

  return items;
}

/**
 * Extract a record of child fields from a single element using child selector syntax.
 */
function extractChildFields(
  $: CheerioAPI,
  el: AnyNode,
  children: Record<string, string>,
): Record<string, string> {
  const item: Record<string, string> = {};
  const elementText = $(el).text().replaceAll(/\s+/g, " ").trim();

  for (const [childField, childSelector] of Object.entries(children)) {
    const value = extractChildValue($, el, childSelector, elementText);
    if (value) item[childField] = value;
  }

  return item;
}

/**
 * Extract a single child field value using the appropriate strategy for its selector.
 */
function extractChildValue(
  $: CheerioAPI,
  el: AnyNode,
  childSelector: string,
  elementText: string,
): string | undefined {
  // _text: full element text
  if (childSelector === "_text") {
    return elementText || undefined;
  }

  // _regex:pattern: extract via regex from element text
  if (childSelector.startsWith("_regex:")) {
    const pattern = childSelector.slice(7);
    try {
      const match = new RegExp(pattern).exec(elementText);
      return match?.[1]?.trim() || undefined;
    } catch {
      // Invalid regex — skip this field
      return undefined;
    }
  }

  // Standard CSS selector with optional "|attr:name" suffix
  const [sel, attrSpec] = childSelector.split("|attr:");
  const child = $(el).find(sel);
  if (child.length === 0) return undefined;

  return attrSpec
    ? child.first().attr(attrSpec)
    : child.first().text().replaceAll(/\s+/g, " ").trim() || undefined;
}
