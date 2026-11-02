/**
 * Manifest Comparator
 *
 * Compares structure, prompt and config hashes to determine
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
    | "both_changed"
    | "config_changed";
  /** Whether the HTML structure changed */
  structureChanged: boolean;
  /** Whether the analysis prompt changed */
  promptChanged: boolean;
  /**
   * Whether the data-source config the manifest was derived from changed
   * (meetings-phase-b.md §4b). False for a manifest with no config hash —
   * a legacy row, which the caller stamps instead of re-deriving.
   */
  configChanged: boolean;
}

export class ManifestComparator {
  /**
   * Compare a cached manifest against current structure and prompt hashes.
   *
   * @param existing - The cached manifest (or undefined if none exists)
   * @param currentStructureHash - SHA-256 hash of the current HTML skeleton
   * @param currentPromptHash - SHA-256 hash of the current analysis prompt
   * @param currentConfigHash - `manifestConfigHash` of the live source config;
   *   omitted, the config axis goes unchecked
   * @returns Comparison result indicating if the manifest can be reused
   */
  static compare(
    existing: StructuralManifest | undefined,
    currentStructureHash: string,
    currentPromptHash: string,
    currentConfigHash?: string,
  ): ComparisonResult {
    if (!existing) {
      return {
        canReuse: false,
        reason: "no_manifest",
        structureChanged: false,
        promptChanged: false,
        configChanged: false,
      };
    }

    const structureChanged = existing.structureHash !== currentStructureHash;
    const promptChanged = existing.promptHash !== currentPromptHash;
    const configChanged =
      currentConfigHash !== undefined &&
      existing.configHash !== undefined &&
      existing.configHash !== currentConfigHash;
    const changed = { structureChanged, promptChanged, configChanged };
    const reason = ManifestComparator.reasonFor(changed);

    return reason
      ? { canReuse: false, reason, ...changed }
      : { canReuse: true, ...changed };
  }

  /**
   * The first reason that applies. Structure and prompt keep their combined
   * `both_changed`; a config change is reported only when neither moved, so
   * existing reason values (logs, metrics) keep their meaning.
   */
  private static reasonFor(changed: {
    structureChanged: boolean;
    promptChanged: boolean;
    configChanged: boolean;
  }): ComparisonResult["reason"] {
    if (changed.structureChanged && changed.promptChanged) {
      return "both_changed";
    }
    if (changed.structureChanged) return "structure_changed";
    if (changed.promptChanged) return "prompt_changed";
    if (changed.configChanged) return "config_changed";
    return undefined;
  }
}
