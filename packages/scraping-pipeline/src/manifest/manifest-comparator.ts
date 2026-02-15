/**
 * Manifest Comparator
 *
 * Compares structure hashes and prompt hashes to determine
 * if a cached manifest can be reused or if re-analysis is needed.
 */

import type { StructuralManifest } from "@opuspopuli/common";

export interface ComparisonResult {
  /** Whether the cached manifest can be reused */
  canReuse: boolean;
  /** Why the manifest cannot be reused */
  reason?:
    | "no_manifest"
    | "structure_changed"
    | "prompt_changed"
    | "both_changed";
  /** Whether the HTML structure changed */
  structureChanged: boolean;
  /** Whether the analysis prompt changed */
  promptChanged: boolean;
}

export class ManifestComparator {
  /**
   * Compare a cached manifest against current structure and prompt hashes.
   *
   * @param existing - The cached manifest (or undefined if none exists)
   * @param currentStructureHash - SHA-256 hash of the current HTML skeleton
   * @param currentPromptHash - SHA-256 hash of the current analysis prompt
   * @returns Comparison result indicating if the manifest can be reused
   */
  static compare(
    existing: StructuralManifest | undefined,
    currentStructureHash: string,
    currentPromptHash: string,
  ): ComparisonResult {
    if (!existing) {
      return {
        canReuse: false,
        reason: "no_manifest",
        structureChanged: false,
        promptChanged: false,
      };
    }

    const structureChanged = existing.structureHash !== currentStructureHash;
    const promptChanged = existing.promptHash !== currentPromptHash;

    if (structureChanged && promptChanged) {
      return {
        canReuse: false,
        reason: "both_changed",
        structureChanged: true,
        promptChanged: true,
      };
    }

    if (structureChanged) {
      return {
        canReuse: false,
        reason: "structure_changed",
        structureChanged: true,
        promptChanged: false,
      };
    }

    if (promptChanged) {
      return {
        canReuse: false,
        reason: "prompt_changed",
        structureChanged: false,
        promptChanged: true,
      };
    }

    return {
      canReuse: true,
      structureChanged: false,
      promptChanged: false,
    };
  }
}
