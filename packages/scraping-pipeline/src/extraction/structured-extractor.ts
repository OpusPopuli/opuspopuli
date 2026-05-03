import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element, AnyNode } from "domhandler";
import type { ChildFieldConfig } from "@opuspopuli/common";
import { FieldTransformer } from "./field-transformer.js";

/**
 * Extracts an array of structured objects from repeating elements matched by a CSS selector.
 *
 * Each matched element becomes one object; the `children` record maps child field names
 * to either a string-shortcut selector or a full ChildFieldConfig object.
 *
 * **String shortcut forms:**
 * - `"_text"` — the full text content of the element
 * - `"_regex:PATTERN"` — capture group 1 from element text
 * - `"css-selector|attr:name"` — extract an attribute from a descendant
 * - `"css-selector"` — extract text content from a descendant (default)
 *
 * **Object form:** `{ selector, extractionMethod, attribute, regexPattern,
 * regexGroup, transform }`. Supports the same shape as the top-level
 * FieldMapping at child scope, including post-extraction transforms via
 * the shared `FieldTransformer`.
 *
 * @param $ Cheerio API for DOM traversal
 * @param scope The element to search within (for .find())
 * @param selector CSS selector for the repeating items
 * @param children Map of field name → child config (string or object)
 * @param baseUrl Optional base URL for `url_resolve` transforms in object children
 * @returns Array of objects with extracted fields (empty if no matches or no values)
 */
export function extractStructuredArray(
  $: CheerioAPI,
  scope: Cheerio<Element> | Cheerio<AnyNode>,
  selector: string,
  children: Record<string, ChildFieldConfig>,
  baseUrl?: string,
): Record<string, string>[] {
  if (!selector || !children) return [];

  const matches = scope.find(selector);
  const items: Record<string, string>[] = [];

  matches.each((_i, el) => {
    const item = extractChildFields($, el, children, baseUrl);
    if (Object.keys(item).length > 0) items.push(item);
  });

  return items;
}

/**
 * Extract a record of child fields from a single element, dispatching to
 * the right extractor based on whether each child config is a string
 * shortcut or a full object config.
 */
function extractChildFields(
  $: CheerioAPI,
  el: AnyNode,
  children: Record<string, ChildFieldConfig>,
  baseUrl?: string,
): Record<string, string> {
  const item: Record<string, string> = {};
  const elementText = $(el).text().replaceAll(/\s+/g, " ").trim();

  for (const [childField, childConfig] of Object.entries(children)) {
    const value =
      typeof childConfig === "string"
        ? extractFromShortcut($, el, childConfig, elementText)
        : extractFromObjectConfig($, el, childConfig, elementText, baseUrl);
    if (value) item[childField] = value;
  }

  return item;
}

/**
 * String-shortcut DSL — preserved for backward compat with manifests that
 * use the terse form.
 */
function extractFromShortcut(
  $: CheerioAPI,
  el: AnyNode,
  childSelector: string,
  elementText: string,
): string | undefined {
  // _text: full element text
  if (childSelector === "_text") {
    return elementText || undefined;
  }

  // _regex:pattern: extract via regex from element text (capture group 1)
  if (childSelector.startsWith("_regex:")) {
    const pattern = childSelector.slice(7);
    try {
      const match = new RegExp(pattern).exec(elementText);
      return match?.[1]?.trim() || undefined;
    } catch {
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

/**
 * Object-form ChildFieldConfig — full extraction method + optional
 * transform. Mirrors the semantics of top-level FieldMapping but at
 * child scope (no fieldName/scope/required/defaultValue).
 */
function extractFromObjectConfig(
  $: CheerioAPI,
  el: AnyNode,
  config: Exclude<ChildFieldConfig, string>,
  elementText: string,
  baseUrl?: string,
): string | undefined {
  // Default extraction method: regex if only a pattern is given, else text
  const method =
    config.extractionMethod ?? (config.regexPattern ? "regex" : "text");

  let value: string | undefined;

  switch (method) {
    case "regex": {
      if (!config.regexPattern) return undefined;
      // For regex method: optionally narrow to a sub-element first via
      // selector, otherwise run against the parent element's full text.
      const haystack = config.selector
        ? ($(el).find(config.selector).first().text() ?? "")
            .replaceAll(/\s+/g, " ")
            .trim()
        : elementText;
      try {
        const match = new RegExp(config.regexPattern).exec(haystack);
        const group = config.regexGroup ?? 1;
        value = match?.[group]?.trim();
      } catch {
        return undefined;
      }
      break;
    }
    case "attribute": {
      if (!config.selector || !config.attribute) return undefined;
      const child = $(el).find(config.selector);
      if (child.length === 0) return undefined;
      value = child.first().attr(config.attribute);
      break;
    }
    case "text":
    default: {
      // Text from selector, or whole element if no selector given
      if (!config.selector) {
        value = elementText || undefined;
        break;
      }
      const child = $(el).find(config.selector);
      if (child.length === 0) return undefined;
      value = child.first().text().replaceAll(/\s+/g, " ").trim() || undefined;
      break;
    }
  }

  if (value && config.transform) {
    value = FieldTransformer.apply(value, config.transform, baseUrl);
  }

  return value || undefined;
}
