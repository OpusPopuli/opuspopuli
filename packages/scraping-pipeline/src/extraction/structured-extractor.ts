import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element, AnyNode } from "domhandler";
import type { ChildFieldConfig } from "@opuspopuli/common";
import { FieldTransformer } from "./field-transformer.js";
import { safeRegex } from "./safe-regex.js";

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
    const regex = safeRegex(childSelector.slice(7));
    if (!regex) return undefined;
    return regex.exec(elementText)?.[1]?.trim() || undefined;
  }

  // Standard CSS selector with optional "|attr:name" suffix
  const [sel, attrSpec] = childSelector.split("|attr:");
  const child = $(el).find(sel);
  if (child.length === 0) return undefined;

  return attrSpec
    ? child.first().attr(attrSpec)
    : child.first().text().replaceAll(/\s+/g, " ").trim() || undefined;
}

type ObjectChildConfig = Exclude<ChildFieldConfig, string>;

/**
 * Default extraction method when not explicitly set:
 *   - 'regex' when a pattern is present (the only piece of config that
 *     uniquely identifies a regex extraction)
 *   - 'text' otherwise (selector-driven text extraction is the common case)
 */
function resolveExtractionMethod(config: ObjectChildConfig): string {
  return config.extractionMethod ?? (config.regexPattern ? "regex" : "text");
}

/**
 * Run a regex pattern against either the parent element's full text or a
 * narrower child element's text. Returns the configured capture group
 * (default 1). Invalid regexes return undefined rather than throwing.
 */
function extractByRegex(
  $: CheerioAPI,
  el: AnyNode,
  config: ObjectChildConfig,
  elementText: string,
): string | undefined {
  if (!config.regexPattern) return undefined;
  const haystack = config.selector
    ? ($(el).find(config.selector).first().text() ?? "")
        .replaceAll(/\s+/g, " ")
        .trim()
    : elementText;
  const regex = safeRegex(config.regexPattern);
  if (!regex) return undefined;
  const group = config.regexGroup ?? 1;
  return regex.exec(haystack)?.[group]?.trim();
}

function extractByAttribute(
  $: CheerioAPI,
  el: AnyNode,
  config: ObjectChildConfig,
): string | undefined {
  if (!config.selector || !config.attribute) return undefined;
  const child = $(el).find(config.selector);
  if (child.length === 0) return undefined;
  return child.first().attr(config.attribute);
}

/**
 * Default text extraction. With no selector, returns the parent element's
 * full text. With a selector, returns the first matching descendant's text
 * (whitespace-collapsed, trimmed).
 */
function extractByText(
  $: CheerioAPI,
  el: AnyNode,
  config: ObjectChildConfig,
  elementText: string,
): string | undefined {
  if (!config.selector) {
    return elementText || undefined;
  }
  const child = $(el).find(config.selector);
  if (child.length === 0) return undefined;
  return child.first().text().replaceAll(/\s+/g, " ").trim() || undefined;
}

/**
 * Object-form ChildFieldConfig — full extraction method + optional
 * transform. Mirrors the semantics of top-level FieldMapping but at
 * child scope (no fieldName/scope/required/defaultValue).
 */
function extractFromObjectConfig(
  $: CheerioAPI,
  el: AnyNode,
  config: ObjectChildConfig,
  elementText: string,
  baseUrl?: string,
): string | undefined {
  const method = resolveExtractionMethod(config);
  let value: string | undefined;
  switch (method) {
    case "regex":
      value = extractByRegex($, el, config, elementText);
      break;
    case "attribute":
      value = extractByAttribute($, el, config);
      break;
    default:
      value = extractByText($, el, config, elementText);
      break;
  }

  if (value && config.transform) {
    value = FieldTransformer.apply(value, config.transform, baseUrl);
  }

  return value || undefined;
}
