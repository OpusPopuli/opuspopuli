/**
 * Structure Hasher
 *
 * Extracts the structural skeleton of HTML (tags, classes, IDs, roles)
 * and produces a deterministic hash. Text content is stripped so that
 * content changes (new bills, updated meeting times) don't affect the hash,
 * while structural changes (class renames, DOM restructuring) do.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { createHash } from "node:crypto";

/** Attributes preserved in the skeleton (structural, not content) */
const STRUCTURAL_ATTRIBUTES = ["class", "id", "role"] as const;

/** Elements stripped before skeletonization (non-structural) */
const NON_STRUCTURAL_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "link",
  "meta",
] as const;

/**
 * Extract the structural skeleton of HTML.
 *
 * Keeps: tag names, class/id/role attributes, nesting structure.
 * Strips: text content, href/src values, inline styles, data-* attributes,
 *         scripts, styles, SVGs, iframes.
 *
 * @param html - Raw HTML string
 * @returns Skeleton string representing the structural layout
 */
export function extractHtmlSkeleton(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-structural elements
  for (const tag of NON_STRUCTURAL_ELEMENTS) {
    $(tag).remove();
  }

  // Remove HTML comments
  $("*")
    .contents()
    .filter(function () {
      return this.type === "comment";
    })
    .remove();

  const body = $("body").get(0);
  if (!body) {
    return "";
  }

  return skeletonize(body);
}

/**
 * Recursively build a skeleton string from a DOM element.
 * Only preserves tag names and structural attributes.
 */
function skeletonize(el: AnyNode): string {
  if (el.type === "text" || el.type === "comment") {
    return "";
  }
  if (el.type !== "tag") {
    return "";
  }

  const tag = el.tagName;
  const attribs: string[] = [];

  for (const attr of STRUCTURAL_ATTRIBUTES) {
    const value = el.attribs?.[attr];
    if (value) {
      attribs.push(`${attr}="${value}"`);
    }
  }

  const attrStr = attribs.length > 0 ? " " + attribs.join(" ") : "";

  const children = (el.children || [])
    .map(skeletonize)
    .filter(Boolean)
    .join("");

  return `<${tag}${attrStr}>${children}</${tag}>`;
}

/**
 * Compute a SHA-256 hash of the HTML structure.
 *
 * @param html - Raw HTML string
 * @returns Hex-encoded SHA-256 hash of the structural skeleton
 */
export function computeStructureHash(html: string): string {
  const skeleton = extractHtmlSkeleton(html);
  return createHash("sha256").update(skeleton).digest("hex");
}
